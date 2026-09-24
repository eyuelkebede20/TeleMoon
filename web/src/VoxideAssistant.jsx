import { useEffect, useMemo, useRef } from "react";
import { VoxideClient, VoxideWidget, useVoxideVoice } from "@voxide/react";

/**
 * Voxide Client Singleton
 * Configured with Voxide theme and coloring (#FF6600, sharp corners, obsidian dark).
 */
const VOXIDE_KEY = import.meta.env.VITE_VOXIDE_PUBLIC_KEY || "vox_pub_telemoon";

export const voxideClient = new VoxideClient({
  publicKey: VOXIDE_KEY,
  ui: {
    accentColor: "#FF6600",
    theme: "dark",
    cornerRadius: "sharp",
    skin: "glass",
    position: "bottom-right",
    launcherShape: "rounded",
    launcherSize: "md",
    launcherIcon: "mic",
    launcherLabel: "Voice AI",
    headerStyle: "solid",
    statusColorMode: "custom",
    statusColors: {
      connecting: "#FF7A1A",
      listening: "#FF6600",
      thinking: "#E5AD58",
      speaking: "#5EC788",
      executing: "#7EA3CC",
      error: "#E86B6B",
    },
    title: "TeleMoon AI",
    subtitle: "Powered by Voxide Voice",
    visualizer: "wave",
  },
});

/**
 * Voxide Assistant Controller
 * Registers TeleMoon drive capabilities and binds real-time drive telemetry.
 */
export function VoxideAssistant({ driveContext }) {
  const ctxRef = useRef(driveContext);
  ctxRef.current = driveContext;

  useEffect(() => {
    // Register actions once with delegates to the latest drive context
    voxideClient.register({
      searchFiles: {
        description: "Search or filter files and folders in TeleMoon by filename or keyword.",
        params: {
          query: { type: "string", required: true, description: "Search query string" },
        },
        handler: ({ query }) => {
          ctxRef.current?.setQ?.(query);
          return { success: true, message: `Searching for "${query}"` };
        },
      },
      clearSearch: {
        description: "Clear the active search filter and show all files in the current folder.",
        params: {},
        handler: () => {
          ctxRef.current?.setQ?.("");
          return { success: true, message: "Cleared search filter" };
        },
      },
      openFolder: {
        description: "Navigate into a folder by name inside the current directory.",
        params: {
          name: { type: "string", required: true, description: "Name of the subfolder to enter" },
        },
        handler: ({ name }) => {
          const items = ctxRef.current?.items || [];
          const match = items.find(
            (i) => i.type === "folder" && i.name.toLowerCase() === String(name).toLowerCase()
          );
          if (match) {
            ctxRef.current?.onOpenFolder?.(match);
            return { success: true, message: `Entered folder "${match.name}"` };
          }
          return { success: false, message: `Folder "${name}" was not found in this directory.` };
        },
      },
      navigateUp: {
        description: "Navigate one level up in the folder tree.",
        params: {},
        handler: () => {
          const stack = ctxRef.current?.stack || [];
          if (stack.length > 1) {
            ctxRef.current?.setStack?.(stack.slice(0, stack.length - 1));
            return { success: true, message: "Moved up one folder level" };
          }
          return { success: false, message: "Already at the root directory." };
        },
      },
      navigateToRoot: {
        description: "Navigate back to the top-level root directory.",
        params: {},
        handler: () => {
          ctxRef.current?.setTrashMode?.(false);
          const root = ctxRef.current?.stack?.[0];
          if (root) {
            ctxRef.current?.setStack?.([root]);
          }
          return { success: true, message: "Navigated to Root folder" };
        },
      },
      openTrash: {
        description: "View deleted items inside the Trash bin.",
        params: {},
        handler: () => {
          ctxRef.current?.setTrashMode?.(true);
          return { success: true, message: "Opened Trash bin" };
        },
      },
      openDrive: {
        description: "Exit Trash and return to the main drive file browser.",
        params: {},
        handler: () => {
          ctxRef.current?.setTrashMode?.(false);
          return { success: true, message: "Returned to Drive" };
        },
      },
      toggleEncryption: {
        description: "Toggle client-side AES-GCM encryption on or off for subsequent uploads.",
        params: {
          enabled: { type: "boolean", description: "Explicit true/false, or omit to toggle" },
        },
        handler: ({ enabled }) => {
          const current = !!ctxRef.current?.encryptUploads;
          const next = enabled !== undefined ? !!enabled : !current;
          ctxRef.current?.setEncryptUploads?.(next);
          return {
            success: true,
            encrypted: next,
            message: next ? "Client-side AES encryption enabled." : "Client-side encryption disabled.",
          };
        },
      },
      createNewFolder: {
        description: "Create a new subfolder in the current directory.",
        params: {
          name: { type: "string", required: true, description: "Name of the new folder" },
        },
        handler: async ({ name }) => {
          try {
            await ctxRef.current?.createFolder?.(name);
            return { success: true, message: `Created folder "${name}".` };
          } catch (err) {
            return { success: false, error: err.message };
          }
        },
      },
      runStorageScan: {
        description: "Trigger the MTProto storage channel audit scanner to check chunk integrity and repair indices.",
        params: {},
        handler: () => {
          ctxRef.current?.setModal?.({ type: "scan" });
          return { success: true, message: "Opened storage scan and repair dialog." };
        },
      },
      getStorageStatus: {
        description: "Query Telegram MTProto connection state, linked storage channel, and chunk size.",
        params: {},
        handler: () => {
          const s = ctxRef.current?.status;
          return {
            status: s?.telegram || "offline",
            channel: s?.channel || "none",
            chunkBytes: s?.chunkBytes || 0,
            currentPath: ctxRef.current?.stack?.map((x) => x.name).join("/") || "Root",
            itemCount: ctxRef.current?.items?.length || 0,
          };
        },
      },
      trashFile: {
        description: "Move a file or folder into the Trash bin.",
        dangerous: true,
        params: {
          name: { type: "string", required: true, description: "Exact name of the item to trash" },
        },
        handler: async ({ name }) => {
          const items = ctxRef.current?.items || [];
          const match = items.find((i) => i.name.toLowerCase() === String(name).toLowerCase());
          if (!match) {
            return { success: false, message: `Item "${name}" not found in current folder.` };
          }
          await ctxRef.current?.trashNode?.(match);
          return { success: true, message: `Moved "${match.name}" to Trash.` };
        },
      },
    });

    // Bind real-time drive state to every AI exchange
    voxideClient.bindState(() => {
      const c = ctxRef.current;
      if (!c) return { ready: false };
      return {
        ready: true,
        currentFolder: c.cwd?.name || "Root",
        folderId: c.cwd?.id,
        path: c.stack?.map((s) => s.name).join("/") || "Root",
        itemCount: c.items?.length || 0,
        itemsSummary: (c.items || []).slice(0, 30).map((i) => ({
          name: i.name,
          type: i.type,
          size: i.size,
          encrypted: !!i.encrypted,
        })),
        searchActive: !!c.q,
        searchQuery: c.q || "",
        trashActive: !!c.trashMode,
        encryptionActive: !!c.encryptUploads,
        telegramChannel: c.status?.channel || "unlinked",
        telegramStatus: c.status?.telegram || "offline",
      };
    });
  }, []);

  return (
    <div className="voxide-host" aria-label="Voxide AI Voice Assistant">
      <VoxideWidget
        client={voxideClient}
        accentColor="#FF6600"
        theme="dark"
        position="bottom-right"
        title="TeleMoon AI"
      />
    </div>
  );
}

/**
 * Statusbar Telemetry Pill for Voxide
 * Shows live assistant state, mic trigger, and Voxide orange branding.
 */
export function VoxideTelemetryBadge() {
  const voice = useVoxideVoice(voxideClient);

  const isConnected = voice.status !== "idle" && voice.status !== "error";

  const handleToggle = () => {
    if (isConnected) {
      voice.disconnect();
    } else {
      voice.connect().catch(() => {});
    }
  };

  return (
    <button
      type="button"
      className={`voxide-hud ${isConnected ? "voxide-hud-active" : ""}`}
      onClick={handleToggle}
      title={isConnected ? "Click to disconnect voice assistant" : "Click to activate Voxide Voice AI"}
      aria-label="Voxide AI Assistant Status"
    >
      <span className="voxide-badge">
        <span className="voxide-pulse" />
        VOXIDE
      </span>
      <span className="voxide-state-tag mono">
        {voice.status === "listening"
          ? "LISTENING..."
          : voice.status === "thinking"
          ? "THINKING..."
          : voice.status === "speaking"
          ? "SPEAKING..."
          : voice.status === "executing"
          ? `EXEC: ${voice.currentAction || "ACTION"}`
          : voice.status === "connecting"
          ? "CONNECTING..."
          : voice.status === "armed"
          ? "ARMED"
          : "VOICE AI"}
      </span>
    </button>
  );
}
