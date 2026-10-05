// Authority: kernel capability policy (default-deny, explicit grants) + ActionPolicy.
// Named after the referenced `.sea` policies: `gsterm::machine_authority_is_explicit`,
// `gsterm::evidence_accompanies_effects` (runtime checks live with the journeys).
// The human PTY grants NO Cognate authority — machine access is never inferred from it.
import type { Policy } from "@cognate/kernel-api";
import type { ActionPolicy } from "@cognate/runtime-bun";

export const ACTOR_HUMAN = "human";
export const ACTOR_WEBMCP = "webmcp";
export const ACTOR_SYSTEM = "system";

const GRANTED_ACTORS = new Set([ACTOR_HUMAN, ACTOR_WEBMCP, ACTOR_SYSTEM]);
const GRANTED_CAPABILITIES = new Set([
  "process.exec", // J2 structured execution (Cognate @cognate/execution)
  "world.snapshot", // J1/J2/J3 evidence gathering
  "focus.search", // J7–J10 Syntelligent Search (deterministic planner)
]);

const POLICY_ID = "gsterm-machine-authority-is-explicit";
const ACTION_POLICY_ID = "gsterm-actions";

/** Kernel policy: allow only catalogued capability ids for recognized actors; everything else denies. */
export function gstermPolicy(): Policy {
  return {
    authorize(request) {
      if (!GRANTED_ACTORS.has(request.actor.id)) {
        return { allow: false, policyId: POLICY_ID, reason: `actor ${request.actor.id} holds no machine authority (gsterm::machine_authority_is_explicit)` };
      }
      if (!GRANTED_CAPABILITIES.has(request.capability.id)) {
        return { allow: false, policyId: POLICY_ID, reason: `capability ${request.capability.id} is not granted to this application` };
      }
      return { allow: true, policyId: POLICY_ID, reason: `${request.actor.id} may invoke ${request.capability.id}` };
    },
  };
}

const JOURNEY_AGENTS = new Set(["agent.execute", "agent.observe", "agent.focus"]);
const WORLD_THREAD_PREFIX = "session:";
const FOCUS_THREAD_PREFIX = "focus:";

/** Service-level actions: runs, world-state threads, and the D2 remote-offer seam. */
export function gstermActions(): ActionPolicy {
  return {
    authorize({ caller, action, resource }) {
      const deny = (reason: string) => ({ allow: false, reason: `${ACTION_POLICY_ID}: ${reason}` });
      const allow = (reason: string) => ({ allow: true, reason: `${ACTION_POLICY_ID}: ${reason}` });
      if (!GRANTED_ACTORS.has(caller.actor.id)) return deny(`actor ${caller.actor.id} not recognized`);
      switch (action) {
        case "run.start":
          return JOURNEY_AGENTS.has(resource) ? allow(`journey agent ${resource}`) : deny(`agent ${resource} is not a catalogued journey`);
        case "run.cancel":
          return allow("caller cancellation (tenant scoping applies)");
        case "thread.state.read":
          return resource.startsWith(WORLD_THREAD_PREFIX) || resource.startsWith(FOCUS_THREAD_PREFIX) ? allow("session/focus thread") : deny("state is session/focus-scoped");
        case "thread.state.update":
          if (resource.startsWith(WORLD_THREAD_PREFIX)) return allow("session world thread");
          // SharedFocus is human-governed (gsterm::human_governs_shared_focus): only human authority
          // may change it. An agent may read it and propose candidates, never update it.
          if (resource.startsWith(FOCUS_THREAD_PREFIX)) return caller.actor.id === ACTOR_HUMAN ? allow("human governs SharedFocus") : deny("SharedFocus is human-governed");
          return deny("state is session/focus-scoped");
        case "observation.record":
          // Reality facts noticed by the mechanism/observer layer — recorded as observations, not actions.
          return allow("observation ingestion (facts, not actions)");
        case "remote.offer.publish":
        case "remote.offer.list":
        case "remote.offer.revoke":
        case "remote.offer.invoke":
          return allow("D2 seam: caller-scoped, lease-bound offers (interface only in v0)");
        case "continuation.resume":
        case "continuation.cancel":
          return allow("continuations of catalogued journeys");
        default:
          return deny("unhandled action");
      }
    },
  };
}
