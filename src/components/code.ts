// Precise code semantic capabilities (Phase 3.5): `code.definition`,
// `code.references`, `code.implementations`, `code.diagnostics` as Cognate
// capability contracts, backed by the SolidLSP mechanism. One capability per
// world — worldId gates mounting (remote worlds are refused honestly). The
// mechanism is implementation detail: callers ask for references, never for
// "solidlsp". Positions are 1-based (semantic convention); conversion to the
// LSP's 0-based happens here, once.
import type { Component } from "@cognate/kernel-api";
import type { SolidLspBridge } from "../mechanisms/solidlsp.ts";

export const CODE_CAPABILITIES = {
  definition: { id: "code.definition", version: "1.0.0" },
  references: { id: "code.references", version: "1.0.0" },
  implementations: { id: "code.implementations", version: "1.0.0" },
  diagnostics: { id: "code.diagnostics", version: "1.0.0" },
} as const;

export interface CodeInput {
  readonly worldId: string;
  /** Workspace-relative path. */
  readonly file: string;
  /** 1-based position of the symbol (semantic convention; converted to LSP 0-based). */
  readonly line: number;
  readonly column: number;
  readonly includeDeclaration?: boolean;
}

export interface CodeServices {
  /**
   * Resolve the SolidLSP bridge for the world with the workspace already
   * started. Throws for remote worlds (honest unavailability) and when the
   * bridge is not mounted.
   */
  code(input: { readonly worldId: string }): Promise<{ readonly bridge: SolidLspBridge }>;
}

export interface CodeLocation {
  readonly file: string;
  readonly start: { readonly line: number; readonly character: number };
  readonly end: { readonly line: number; readonly character: number };
}

/** Convert mechanism (0-based) locations to the semantic 1-based convention. */
function toSemantic(location: { file: string; start: { line: number; character: number }; end: { line: number; character: number } }): CodeLocation {
  return {
    file: location.file,
    start: { line: location.start.line + 1, character: location.start.character + 1 },
    end: { line: location.end.line + 1, character: location.end.character + 1 },
  };
}

function parse(raw: unknown): CodeInput {
  const input = (raw ?? {}) as Partial<CodeInput>;
  if (typeof input.worldId !== "string" || input.worldId === "") throw new Error("code capability requires worldId");
  if (typeof input.file !== "string" || input.file === "") throw new Error("code capability requires file");
  if (typeof input.line !== "number" || input.line < 1) throw new Error("code capability requires a 1-based line");
  if (typeof input.column !== "number" || input.column < 1) throw new Error("code capability requires a 1-based column");
  return { worldId: input.worldId, file: input.file, line: input.line, column: input.column, includeDeclaration: input.includeDeclaration === true };
}

export function codeComponent(services: CodeServices): Component {
  return {
    id: "gsterm:code",
    provides: Object.values(CODE_CAPABILITIES).map((contract) => ({ ...contract })),
    activate(fiber) {
      const withBridge = async (raw: unknown, operation: string): Promise<unknown> => {
        const input = parse(raw);
        const { bridge } = await services.code({ worldId: input.worldId });
        // Mechanism positions are 0-based; semantic inputs are 1-based.
        const file = input.file;
        const line = input.line - 1;
        const column = input.column - 1;
        if (operation === "definition") {
          return { locations: (await bridge.definition(file, line, column)).map(toSemantic) };
        }
        if (operation === "references") {
          return { locations: (await bridge.references(file, line, column, input.includeDeclaration)).map(toSemantic) };
        }
        if (operation === "implementations") {
          return { locations: (await bridge.implementations(file, line, column)).map(toSemantic) };
        }
        return { diagnostics: await bridge.diagnostics(file) };
      };
      fiber.provide(CODE_CAPABILITIES.definition, (raw) => withBridge(raw, "definition"));
      fiber.provide(CODE_CAPABILITIES.references, (raw) => withBridge(raw, "references"));
      fiber.provide(CODE_CAPABILITIES.implementations, (raw) => withBridge(raw, "implementations"));
      fiber.provide(CODE_CAPABILITIES.diagnostics, (raw) => withBridge(raw, "diagnostics"));
    },
  };
}
