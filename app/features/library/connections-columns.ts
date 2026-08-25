export const CONNECTIONS_COLUMNS = [
  { id: "fit", label: "Fit" },
  { id: "name", label: "Fragment" },
  { id: "source", label: "Source" },
  { id: "signal", label: "Signal" },
  { id: "date", label: "Imported" },
  { id: "key", label: "Key" },
  { id: "tempo", label: "BPM" },
  { id: "role", label: "Role" },
  { id: "actions", label: "" },
] as const;

export type ConnectionsColumnId = (typeof CONNECTIONS_COLUMNS)[number]["id"];
