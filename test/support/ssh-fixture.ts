// The vendored `@cognate/execution-ssh` fixture is real runtime code whose .ts source carries a
// DOM/Node stream typing quirk (skipLibCheck cannot skip .ts). Loaded through a non-literal
// dynamic import: TypeScript leaves it untyped (the module is not pulled into the program) while
// Bun executes the genuine module. Types below are the fixture's public surface, declared here.
export interface SshFixture {
  readonly port: number;
  readonly hostKeyPem: string;
  readonly fingerprint: string;
  readonly knownHostsLine: (host?: string) => string;
  readonly stats: { connections: number; open: number; execs: number; sftp: number; sftpOpens: number; liveExecs: number };
  dropConnections(): void;
  close(): Promise<void>;
}

export interface SshFixtureModule {
  startSshFixture(options: {
    readonly users: Readonly<Record<string, { readonly password?: string; readonly publicKeys?: readonly string[] }>>;
  }): Promise<SshFixture>;
}

export async function loadSshFixture(): Promise<SshFixtureModule> {
  const specifier = ["@cognate/execution-ssh", "fixture"].join("/"); // non-literal on purpose
  return (await import(specifier)) as SshFixtureModule;
}
