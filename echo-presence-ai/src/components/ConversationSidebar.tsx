import { Plus, X, Settings, MoreHorizontal, Share2, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { groupByDay, type Conversation } from "@/store/conversations";
import { getSelectedVoice, subscribeSelectedVoice } from "@/store/voiceSettings";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface ConversationSidebarProps {
  open: boolean;
  conversations: Conversation[];
  activeId: string | null;
  onClose: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onOpenSettings?: () => void;
}

export function ConversationSidebar({
  open,
  conversations,
  activeId,
  onClose,
  onNew,
  onSelect,
  onDelete,
  onRename,
  onOpenSettings,
}: ConversationSidebarProps) {
  const [renameTarget, setRenameTarget] = useState<Conversation | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Conversation | null>(null);
  const [selectedVoice, setSelectedVoice] = useState(() => getSelectedVoice());

  useEffect(() => {
    return subscribeSelectedVoice(setSelectedVoice);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const groups = groupByDay(conversations);

  const handleShare = (conv: Conversation) => {
    // TODO: replace with real share link when backend is wired up.
    const placeholder = `${window.location.origin}/?c=${conv.id}`;
    navigator.clipboard?.writeText(placeholder).catch(() => undefined);
    toast.success("Đã sao chép liên kết chia sẻ");
  };

  const openRename = (conv: Conversation) => {
    setRenameTarget(conv);
    setRenameValue(conv.title);
  };

  const submitRename = () => {
    if (renameTarget) onRename(renameTarget.id, renameValue);
    setRenameTarget(null);
  };

  const confirmDelete = () => {
    if (deleteTarget) onDelete(deleteTarget.id);
    setDeleteTarget(null);
  };

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${open ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        onClick={onClose}
        aria-hidden
      />

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[86vw] max-w-[300px] flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-2xl transition-transform duration-300 ease-out ${open ? "translate-x-0" : "-translate-x-full"
          }`}
        aria-hidden={!open}
      >
        <div className="flex items-center justify-between px-3 pt-3 pb-1">
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="rounded-full p-2 text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-3 pb-3">
          <button
            type="button"
            onClick={() => {
              onNew();
              onClose();
            }}
            className="flex w-full items-center gap-2 overflow-hidden rounded-xl border border-sidebar-border bg-sidebar-accent/40 px-3 py-2.5 text-sm font-medium text-sidebar-foreground transition hover:bg-sidebar-accent"
          >
            <Plus className="h-4 w-4 shrink-0" />
            <span className="truncate">Đoạn hội thoại mới</span>
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-2 pb-4">
          {groups.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-sidebar-foreground/60">
              Chưa có đoạn hội thoại nào.
            </p>
          )}
          {groups.map((group) => (
            <div key={group.label}>
              <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/50">
                {group.label}
              </div>
              <ul className="space-y-0.5">
                {group.items.map((conv) => {
                  const isActive = conv.id === activeId;
                  return (
                    <li key={conv.id}>
                      <div
                        className={`group relative flex h-11 items-center gap-2 rounded-lg pl-3 pr-1 transition ${isActive
                            ? "bg-sidebar-accent"
                            : "hover:bg-sidebar-accent/60"
                          }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onSelect(conv.id);
                            onClose();
                          }}
                          className="min-w-0 flex-1 truncate text-left text-sm text-sidebar-foreground"
                          title={conv.title}
                        >
                          {conv.title}
                        </button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              aria-label="Tuỳ chọn"
                              onClick={(e) => e.stopPropagation()}
                              className={`shrink-0 rounded-md p-1.5 text-sidebar-foreground/60 transition hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground ${isActive
                                  ? "opacity-100"
                                  : "opacity-0 group-hover:opacity-100 focus:opacity-100"
                                }`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40">
                            <DropdownMenuItem onSelect={() => handleShare(conv)}>
                              <Share2 className="mr-2 h-4 w-4" /> Chia sẻ
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => openRename(conv)}>
                              <Pencil className="mr-2 h-4 w-4" /> Đổi tên
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => setDeleteTarget(conv)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" /> Xoá
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <div className="border-t border-sidebar-border px-3 py-3">
          <button
            type="button"
            onClick={() => {
              onOpenSettings?.();
              onClose();
            }}
            className="flex w-full items-center gap-3 overflow-hidden rounded-xl px-3 py-2 text-sm text-sidebar-foreground/80 transition hover:bg-sidebar-accent"
          >
            <Settings className="h-4 w-4 shrink-0" />
            <span className="truncate">Cài đặt giọng ({selectedVoice})</span>
          </button>
        </div>
      </aside>

      <Dialog open={!!renameTarget} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Đổi tên đoạn hội thoại</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitRename()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>
              Huỷ
            </Button>
            <Button onClick={submitRename}>Lưu</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xoá đoạn hội thoại?</AlertDialogTitle>
            <AlertDialogDescription>
              Hành động này không thể hoàn tác. Đoạn hội thoại "{deleteTarget?.title}" sẽ bị xoá vĩnh viễn.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Xoá</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
