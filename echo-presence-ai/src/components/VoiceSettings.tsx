import { useEffect, useState } from "react";
import { X, Check, RefreshCw, Mic } from "lucide-react";

import {
  fetchAvailableVoices,
  getSelectedVoice,
  setSelectedVoice,
  type OwnerVoiceProfile,
} from "@/store/voiceSettings";

interface VoiceSettingsProps {
  open: boolean;
  onClose: () => void;
}

export function VoiceSettings({ open, onClose }: VoiceSettingsProps) {
  const [voices, setVoices] = useState<OwnerVoiceProfile[]>([]);
  const [selected, setSelected] = useState<string>(() => getSelectedVoice());
  const [loading, setLoading] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setWarning(null);
    const result = await fetchAvailableVoices();
    setVoices(result.voices);
    if (result.usingFallback && result.error) setWarning(result.error);
    // Ensure the currently selected voice is still valid; else pick the first.
    if (result.voices.length > 0 && !result.voices.find((v) => v.name === selected)) {
      const next = result.voices[0].name;
      setSelected(next);
      setSelectedVoice(next);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (open) void load();
  }, [open]);

  if (!open) return null;

  const handlePick = (name: string) => {
    setSelected(name);
    setSelectedVoice(name);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/15 bg-slate-900/95 p-5 text-white shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Cài đặt giọng Lumi</h2>
            <p className="text-xs text-white/60">
              Chọn profile giọng từ thư mục <code>owner_voices/</code>
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void load()}
              aria-label="Tải lại"
              className="rounded-lg p-1.5 hover:bg-white/10"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Đóng"
              className="rounded-lg p-1.5 hover:bg-white/10"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {warning && (
          <p className="mb-3 rounded-md bg-amber-500/15 px-3 py-2 text-xs text-amber-100">
            {warning}
          </p>
        )}

        <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
          {voices.length === 0 && !loading && (
            <li className="rounded-md bg-white/5 px-3 py-3 text-center text-xs text-white/60">
              Chưa có giọng nào trong owner_voices/
            </li>
          )}
          {voices.map((v) => {
            const active = v.name === selected;
            return (
              <li key={v.name}>
                <button
                  type="button"
                  onClick={() => handlePick(v.name)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    active
                      ? "border-sky-400/60 bg-sky-400/15"
                      : "border-white/10 bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Mic className="h-4 w-4 text-sky-300" />
                    <div>
                      <div className="text-sm font-medium">{v.name}</div>
                      <div className="text-[11px] text-white/55">
                        {v.sample_count} mẫu giọng
                      </div>
                    </div>
                  </div>
                  {active && <Check className="h-4 w-4 text-sky-300" />}
                </button>
              </li>
            );
          })}
        </ul>

        <p className="mt-4 text-[11px] text-white/45">
          Thêm giọng mới: tạo thư mục <code>owner_voices/&lt;Tên&gt;/</code> rồi đặt
          các file .wav/.mp3 mẫu vào đó.
        </p>
      </div>
    </div>
  );
}
