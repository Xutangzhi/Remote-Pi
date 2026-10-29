// Wire shapes used by the desktop client. The remote Pi Web service remains
// authoritative for session storage, tool execution and working directories.
export interface Project { id: string; name: string; path: string; createdAt: string; }
export interface Workspace { id: string; projectId: string; path: string; label: string; isMain: boolean; provider?: { metadata?: Record<string, unknown> }; }
export interface SessionRef { id: string; cwd: string; }
export interface SessionInfo extends SessionRef { path?: string; parentSessionPath?: string; agentSubsession?: boolean; name?: string; firstMessage: string; created: string; modified: string; messageCount: number; archived?: boolean; }
export interface Model { provider?: string; id?: string; name?: string; contextWindow?: number; }
export interface ExtensionDialog { dialogId: string; kind: 'confirm' | 'select' | 'input'; title: string; message?: string; options?: string[]; placeholder?: string; }
export interface AskQuestion { id: string; question: string; detail?: string; multiple?: boolean; options: { value: string; label: string; detail?: string }[]; }
export interface AskRequest { askId: string; questions: AskQuestion[]; }
export interface SessionStatus {
  sessionId: string; model?: Model; thinkingLevel?: string;
  isStreaming: boolean; isCompacting: boolean; isBashRunning: boolean;
  pendingMessageCount: number; queuedMessages?: { kind: string; text: string }[];
  tokens?: { total: number; input: number; output: number }; cost?: number;
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
  pendingDialogs?: ExtensionDialog[]; warnings?: { message: string; severity?: string }[];
}
export interface MachineStatusSnapshot { epochId: string; revision: number; sessions: Record<string, Record<string, boolean>>; }
export interface SessionActivity { sessionId: string; phase: 'active' | 'idle' | 'error'; label: string; startup?: boolean; }
export interface UnreadSummary { sessionId: string; cwd: string; completionOrder: number; completedAt: string; }
export interface UnreadCatalog { catalogId: string; catalogRevision: number; sessions: UnreadSummary[]; }
export interface UnreadEvent { type: 'sessions.unread'; catalogId: string; catalogRevision: number; sessionId: string; cwd: string; unread: UnreadSummary | null; }
export type CatalogEvent =
  | { type: 'machine.status'; status: MachineStatusSnapshot }
  | UnreadEvent
  | { type: 'status.update'; status: SessionStatus }
  | { type: 'activity.update'; activity: SessionActivity }
  | { type: 'catalog.connected' | 'session.created' | 'session.name' | 'session.archived' | 'session.restored' | 'workspaces.changed' | 'session.tree.changed' | 'models.changed'; session?: SessionInfo; sessionId?: string; name?: string };
export interface WireMessage {
  role: string; entryId?: string; streamId?: string; timestamp?: number | string;
  content?: string | Record<string, unknown>[]; parts?: Record<string, unknown>[];
  toolCallId?: string; toolName?: string; isError?: boolean; details?: Record<string, unknown>;
  model?: string; stopReason?: string; errorMessage?: string; command?: string; output?: string;
  customType?: string; display?: boolean; summary?: string;
}
export interface MessagePage { messages: WireMessage[]; start: number; total: number; }
export interface TranscriptSnapshot { page: MessagePage; partial: WireMessage | null; seq: number; status: SessionStatus; }
export interface SessionEvent {
  type: string; seq?: number; text?: string; streamId?: string; message?: WireMessage | string;
  toolCallId?: string; toolName?: string; summary?: string; args?: unknown; content?: unknown; details?: Record<string, unknown>;
  isError?: boolean; status?: SessionStatus; dialog?: ExtensionDialog; dialogId?: string; name?: string; sessionId?: string;
  command?: string; chunk?: string; output?: string; exitCode?: number; session?: SessionInfo;
}
export type WorkspacePacket =
  | { type: 'catalog'; event: CatalogEvent }
  | { type: 'snapshot'; subscriptionId: string; session: SessionRef; snapshot: TranscriptSnapshot }
  | { type: 'event'; subscriptionId: string; session: SessionRef; event: SessionEvent }
  | { type: 'stream'; subscriptionId: string; session: SessionRef; state: 'connecting' | 'live' | 'reconnecting' | 'error'; message?: string };
export interface FileEntry { name: string; path: string; type: 'file' | 'directory' | 'symlink'; }
export interface FileTree { path: string; entries: FileEntry[]; truncated: boolean; }
export interface FileContent { path: string; content: string; binary: boolean; truncated: boolean; language?: string; }
export interface GitStatus { isGitRepo: boolean; branch?: string; files: { path: string; index: string; workingTree: string }[]; }
export interface Attachment { kind: 'image'; mimeType: string; data: string; name?: string; }
export interface SlashCommand { name: string; description?: string; argumentHint?: string; source: 'builtin' | 'extension' | 'prompt' | 'skill'; }
export interface FileSuggestion { path: string; kind: 'tracked' | 'untracked' | 'other'; }
export interface CommandOption { value: string; label: string; description?: string; }
export interface SessionTreeSnapshot { nodes: { id: string; parentId: string | null; kind: string; summary: string; label?: string }[]; activeLeafId: string | null; activePathIds: string[]; }
export type CommandResult =
  | { type: 'done'; message?: string; session?: SessionInfo; promptDraft?: string }
  | { type: 'select'; requestId: string; title: string; options: CommandOption[] }
  | { type: 'tree'; tree: SessionTreeSnapshot }
  | { type: 'unsupported'; message: string };
export interface TerminalPacket { subscriptionId: string; type: 'output' | 'exit' | 'error' | 'ready'; data?: string; message?: string; exitCode?: number; }
export type PiOperation = 'machine.status' | 'sessions.unread' | 'session.acknowledgeUnread' | 'projects.list' | 'projects.add' | 'projects.directories' | 'workspaces.list' | 'workspace.trust'
  | 'sessions.list' | 'session.create' | 'session.messages' | 'session.prompt' | 'session.abort' | 'session.archive' | 'session.restore'
  | 'session.rename' | 'session.models' | 'session.model' | 'session.thinkingLevels' | 'session.thinking' | 'session.dialog'
  | 'session.ask' | 'session.media' | 'session.commands' | 'session.command' | 'session.command.respond' | 'session.shell'
  | 'session.tree.navigate' | 'session.tree.fork' | 'files.suggest' | 'files.tree' | 'files.read' | 'git.status' | 'git.diff';
