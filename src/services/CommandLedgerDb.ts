import Dexie, { type Table } from 'dexie';

/**
 * Immutable Command Ledger Schema stored in IndexedDB via Dexie.js
 * Records: [timestamp, command_input, involved_agent, tool_used, result_summary, success_boost_achieved, ledger_hash]
 */
export interface CommandLedgerEntry {
  id?: number;
  timestamp: string;
  command_input: string;
  involved_agent: string;
  tool_used: string;
  result_summary: string;
  success_boost_achieved: number;
  ledger_hash: string;
}

/**
 * Isolated Agent Memory Schema stored in Dexie.js IndexedDB.
 * Separate memory tables per agent retaining distinct operational histories and reflections over time.
 */
export interface AgentMemoryDbEntry {
  id?: number;
  agentId: string;
  timestamp: string;
  prompt: string;
  summary: string;
  reflection?: string;
}

function computeImmutableHash(
  payload: Omit<CommandLedgerEntry, 'id' | 'ledger_hash'>
): string {
  const raw = `${payload.timestamp}|${payload.command_input}|${payload.involved_agent}|${payload.tool_used}|${payload.result_summary}|${payload.success_boost_achieved}`;
  let h1 = 0xdeadbeef ^ raw.length;
  let h2 = 0x41c6ce57 ^ raw.length;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `0x${hex1}${hex2}`;
}

class PixelOpsLedgerDatabase extends Dexie {
  command_ledger!: Table<CommandLedgerEntry, number>;
  agent_memories!: Table<AgentMemoryDbEntry, number>;

  constructor() {
    super('PixelOpsImmutableLedgerDB');

    this.version(2).stores({
      command_ledger:
        '++id, timestamp, involved_agent, tool_used, success_boost_achieved, ledger_hash',
      agent_memories:
        '++id, agentId, timestamp, prompt',
    });

    // Enforce append-only immutability on the command_ledger table
    this.command_ledger.hook('updating', function () {
      throw new Error(
        'IMMUTABLE_LEDGER_VIOLATION: Command ledger records cannot be modified once committed.'
      );
    });

    this.command_ledger.hook('deleting', function () {
      throw new Error(
        'IMMUTABLE_LEDGER_VIOLATION: Command ledger records cannot be deleted once committed.'
      );
    });
  }
}

export const ledgerDb = new PixelOpsLedgerDatabase();

const INITIAL_SEED_COMMANDS: Array<
  Omit<CommandLedgerEntry, 'id' | 'ledger_hash'>
> = [
  {
    timestamp: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
    command_input: 'Verify encrypted dossier archives and index Cipher lectern keys',
    involved_agent: 'Agent Cipher',
    tool_used: 'vault_query_intel',
    result_summary: 'Retrieved dossier matches for "Omega Key Index" · 3 steps verified',
    success_boost_achieved: 40,
  },
  {
    timestamp: new Date(Date.now() - 1000 * 60 * 11).toISOString(),
    command_input: 'Audit mainframe blade rack #2 and open patch ticket in core-engine',
    involved_agent: 'Agent Nyx',
    tool_used: 'github_create_issue',
    result_summary: 'Opened ticket "Mainframe Blade #2 Firewall Patch" in pixelops/core-engine',
    success_boost_achieved: 80,
  },
  {
    timestamp: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
    command_input: 'Scan web nodes for flight data and parse JSON telemetry.',
    involved_agent: 'Agent Vance',
    tool_used: 'vault_query_intel',
    result_summary: 'Flight Node Telemetry Scan: 4 tool schemas registered & JSON verified',
    success_boost_achieved: 100,
  },
];

/**
 * Appends a new immutable command record to the Dexie/IndexedDB ledger.
 */
export async function appendCommandLedgerEntry(
  entry: Omit<CommandLedgerEntry, 'id' | 'ledger_hash'>
): Promise<CommandLedgerEntry> {
  const fullRecord: CommandLedgerEntry = {
    ...entry,
    ledger_hash: computeImmutableHash(entry),
  };
  const id = await ledgerDb.command_ledger.add(fullRecord);
  return {
    ...fullRecord,
    id,
  };
}

/**
 * Queries Dexie/IndexedDB for the last 50 commands ordered newest-first.
 */
export async function getLast50Commands(): Promise<CommandLedgerEntry[]> {
  const count = await ledgerDb.command_ledger.count();
  if (count === 0) {
    for (const seed of INITIAL_SEED_COMMANDS) {
      await appendCommandLedgerEntry(seed);
    }
  }

  const records = await ledgerDb.command_ledger
    .orderBy('timestamp')
    .reverse()
    .limit(50)
    .toArray();

  return Object.freeze(records.map((r) => Object.freeze({ ...r }))) as CommandLedgerEntry[];
}

/**
 * Appends a memory/reflection entry to an agent's isolated memory table in IndexedDB.
 */
export async function appendAgentMemoryEntry(entry: {
  agentId: string;
  prompt: string;
  summary: string;
  reflection?: string;
}): Promise<AgentMemoryDbEntry> {
  const record: AgentMemoryDbEntry = {
    agentId: entry.agentId,
    timestamp: new Date().toISOString(),
    prompt: entry.prompt,
    summary: entry.summary,
    reflection: entry.reflection || `Operational memory logged for ${entry.agentId}`,
  };
  const id = await ledgerDb.agent_memories.add(record);
  return { ...record, id };
}

/**
 * Retrieves isolated memory logs for a specific agent from IndexedDB.
 */
export async function getAgentMemoriesForAgent(agentId: string): Promise<AgentMemoryDbEntry[]> {
  const records = await ledgerDb.agent_memories
    .where('agentId')
    .equals(agentId)
    .reverse()
    .sortBy('timestamp');
  return records;
}

/**
 * Clears isolated memory logs for a specific agent from IndexedDB.
 */
export async function clearAgentMemoriesForAgent(agentId: string): Promise<void> {
  await ledgerDb.agent_memories.where('agentId').equals(agentId).delete();
}
