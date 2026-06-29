import { useEffect, useState, useRef } from "react";
import { X, Check, RefreshCw, Mic, Plus, Play, Pause, Trash2, ArrowLeft, Loader2 } from "lucide-react";

import {
  fetchAvailableVoices,
  getSelectedVoice,
  setSelectedVoice,
  uploadOwnerVoiceSample,
  deleteOwnerVoices,
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

  // States for recording new voice profile
  const [isAdding, setIsAdding] = useState(false);
  const [newVoiceName, setNewVoiceName] = useState("");
  const [recordingState, setRecordingState] = useState<"idle" | "recording" | "review" | "uploading">("idle");
  const [duration, setDuration] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [targetSampleIndex, setTargetSampleIndex] = useState(1);
  const [isPreExisting, setIsPreExisting] = useState(false);
  const [sampleText, setSampleText] = useState("");

  // States for deleting voice profiles
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedForDelete, setSelectedForDelete] = useState<string[]>([]);

  // Refs for audio capturing
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const audioBuffersRef = useRef<Float32Array[]>([]);
  const audioSampleRateRef = useRef<number>(44100);
  const timerRef = useRef<number | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);

  const resetRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (audioProcessorRef.current) {
      try { audioProcessorRef.current.disconnect(); } catch {}
      audioProcessorRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current = null;
    }
    setAudioBlob(null);
    setRecordingState("idle");
    setIsPreviewPlaying(false);
    setSampleText("");
  };

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

  const handlePick = (name: string) => {
    setSelected(name);
    setSelectedVoice(name);
  };

  const handleAddSampleTo = (name: string, currentSampleCount: number) => {
    setIsAdding(true);
    setIsPreExisting(true);
    setNewVoiceName(name);
    setTargetSampleIndex(currentSampleCount + 1);
  };

  const handleToggleDeleteSelect = (name: string) => {
    setSelectedForDelete((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  const handleDeleteSelected = async () => {
    if (selectedForDelete.length === 0) return;
    if (!confirm(`Bạn có chắc chắn muốn xóa ${selectedForDelete.length} giọng nói đã chọn?`)) return;

    setLoading(true);
    const result = await deleteOwnerVoices(selectedForDelete);
    if (result.status === "done") {
      setIsDeleting(false);
      setSelectedForDelete([]);
      void load();
    } else {
      alert(result.error || "Không thể xóa các giọng nói đã chọn.");
    }
    setLoading(false);
  };

  // Recording action handlers
  const startRecording = async () => {
    const cleanName = newVoiceName.trim();
    if (!cleanName) {
      alert("Vui lòng nhập tên giọng nói");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextCtor();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      audioProcessorRef.current = processor;
      audioSampleRateRef.current = audioContext.sampleRate;
      audioBuffersRef.current = [];

      processor.onaudioprocess = (event) => {
        audioBuffersRef.current.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };

      const sink = audioContext.createGain();
      sink.gain.value = 0;

      source.connect(processor);
      processor.connect(sink);
      sink.connect(audioContext.destination);

      setRecordingState("recording");
      setDuration(0);

      timerRef.current = window.setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);

    } catch (err) {
      console.error("Microphone access failed:", err);
      alert("Không thể truy cập Microphone. Vui lòng cấp quyền.");
    }
  };

  const stopRecording = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (audioProcessorRef.current) {
      audioProcessorRef.current.disconnect();
      audioProcessorRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }

    const wavBlob = encodeWav(audioBuffersRef.current, audioSampleRateRef.current);
    setAudioBlob(wavBlob);
    setRecordingState("review");
  };

  const playPreview = () => {
    if (!audioBlob) return;
    if (isPreviewPlaying) {
      audioElementRef.current?.pause();
      setIsPreviewPlaying(false);
    } else {
      const url = URL.createObjectURL(audioBlob);
      const audio = new Audio(url);
      audioElementRef.current = audio;
      audio.onended = () => {
        setIsPreviewPlaying(false);
      };
      void audio.play();
      setIsPreviewPlaying(true);
    }
  };

  const handleSave = async () => {
    if (!audioBlob || !newVoiceName.trim()) return;

    const cleanText = sampleText.trim();
    if (!isPreExisting && !cleanText) {
      alert("Vui lòng nhập nội dung bạn đã nói trong đoạn ghi âm để tránh lỗi phân tích.");
      return;
    }

    setRecordingState("uploading");

    const cleanName = newVoiceName.trim().replace(/[^a-zA-Z0-9_\sÀ-ỹ]/g, "");
    if (!cleanName) {
      alert("Tên giọng nói không hợp lệ.");
      setRecordingState("review");
      return;
    }

    const result = await uploadOwnerVoiceSample(cleanName, audioBlob, targetSampleIndex, cleanText);
    if (result.status === "saved") {
      resetRecording();
      setIsAdding(false);
      setNewVoiceName("");
      setSelected(cleanName);
      setSelectedVoice(cleanName);
      void load();
    } else {
      alert(result.error || "Không thể lưu giọng nói mới.");
      setRecordingState("review");
    }
  };

  const formatDuration = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  useEffect(() => {
    if (open) {
      void load();
    } else {
      resetRecording();
      setIsAdding(false);
      setIsDeleting(false);
      setSelectedForDelete([]);
    }
    return () => {
      resetRecording();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/15 bg-slate-900/95 p-5 text-white shadow-2xl transition-all duration-300">
        
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isAdding && (
              <button
                type="button"
                onClick={() => {
                  resetRecording();
                  setIsAdding(false);
                }}
                className="rounded-lg p-1 hover:bg-white/10"
                aria-label="Quay lại"
              >
                <ArrowLeft className="h-4 w-4 text-white/80" />
              </button>
            )}
            <h2 className="text-base font-semibold">
              {isAdding ? "Ghi âm giọng nói mới" : "Cài đặt giọng Lumi"}
            </h2>
          </div>
          <div className="flex items-center gap-1">
            {!isAdding && (
              <>
                {isDeleting ? (
                  <>
                    <button
                      type="button"
                      onClick={handleDeleteSelected}
                      disabled={selectedForDelete.length === 0}
                      className="rounded-lg px-2 py-1.5 hover:bg-red-500/20 text-red-400 disabled:opacity-40 transition-all flex items-center gap-1 text-xs font-medium"
                      title="Xóa đã chọn"
                    >
                      <Trash2 className="h-4 w-4" />
                      <span>Xóa ({selectedForDelete.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsDeleting(false);
                        setSelectedForDelete([]);
                      }}
                      className="rounded-lg px-2.5 py-1.5 hover:bg-white/10 text-white/70 hover:text-white transition-all text-xs font-medium"
                    >
                      Hủy
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAdding(true);
                        setIsPreExisting(false);
                        setNewVoiceName("");
                        setTargetSampleIndex(1);
                      }}
                      aria-label="Thêm giọng nói"
                      className="rounded-lg p-1.5 hover:bg-white/10 text-sky-400"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsDeleting(true)}
                      aria-label="Xóa giọng nói"
                      className="rounded-lg p-1.5 hover:bg-white/10 text-red-400/80 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void load()}
                      aria-label="Tải lại"
                      className="rounded-lg p-1.5 hover:bg-white/10"
                    >
                      <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                    </button>
                  </>
                )}
              </>
            )}
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

        {/* Warning messages */}
        {warning && !isAdding && (
          <p className="mb-3 rounded-md bg-amber-500/15 px-3 py-2 text-xs text-amber-100">
            {warning}
          </p>
        )}

        {/* Voice List View */}
        {!isAdding ? (
          <ul className="max-h-72 space-y-2 overflow-y-auto px-1.5 py-1 list-none m-0">
            {voices.length === 0 && !loading && (
              <li className="rounded-md bg-white/5 px-3 py-3 text-center text-xs text-white/60">
                Chưa có giọng nào trong owner_voices/
              </li>
            )}
            {voices.map((v) => {
              const active = v.name === selected;
              const isSelectedForDelete = selectedForDelete.includes(v.name);
              return (
                <li key={v.name} className="relative group">
                  <div className="flex w-full items-center gap-2">
                    {isDeleting && (
                      <input
                        type="checkbox"
                        checked={isSelectedForDelete}
                        onChange={() => handleToggleDeleteSelect(v.name)}
                        className="h-4 w-4 rounded border-white/20 bg-white/5 text-red-500 focus:ring-red-500 cursor-pointer shrink-0"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => isDeleting ? handleToggleDeleteSelect(v.name) : handlePick(v.name)}
                      className={`flex-grow flex items-center justify-between rounded-lg border pl-3 ${isDeleting ? "pr-3" : "pr-12"} py-2.5 text-left transition-all duration-200 ${
                        isDeleting
                          ? isSelectedForDelete
                            ? "border-red-500/60 bg-red-500/15 text-red-200"
                            : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                          : active
                          ? "border-sky-400 bg-sky-500/25 text-sky-200 shadow-[0_0_15px_rgba(56,189,248,0.2)] scale-[1.01]"
                          : "border-white/10 bg-white/5 text-white/80 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Mic className={`h-4 w-4 ${active && !isDeleting ? "text-sky-400 animate-pulse" : "text-white/40"}`} />
                        <div>
                          <div className={`text-sm font-medium ${active && !isDeleting ? "text-sky-300" : ""}`}>{v.name}</div>
                          <div className={`text-[11px] ${active && !isDeleting ? "text-sky-300/60" : "text-white/55"}`}>
                            {v.sample_count} mẫu giọng
                          </div>
                        </div>
                      </div>
                      {active && !isDeleting && <Check className="h-4 w-4 text-sky-300" />}
                    </button>
                    {!isDeleting && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddSampleTo(v.name, v.sample_count);
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg hover:bg-white/10 text-sky-400 opacity-60 hover:opacity-100 transition-opacity"
                        title={`Thêm mẫu giọng cho ${v.name}`}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          /* Add New Voice Form */
          <div className="space-y-4 py-2">
            <div>
              <label htmlFor="voice-name" className="block text-xs text-white/60 mb-1.5 font-medium">
                {isPreExisting ? "Thêm mẫu giọng cho" : "Tên giọng nói mới"}
              </label>
              <input
                id="voice-name"
                type="text"
                placeholder="Nhập tên giọng (ví dụ: Bach, LumiNew...)"
                disabled={isPreExisting || recordingState !== "idle"}
                value={newVoiceName}
                onChange={(e) => setNewVoiceName(e.target.value)}
                className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-sky-500 focus:outline-none disabled:opacity-50"
              />
            </div>

            {/* Recording Controls */}
            <div className="flex flex-col items-center justify-center py-6 border border-dashed border-white/10 rounded-xl bg-white/[0.02]">
              {recordingState === "idle" && (
                <button
                  type="button"
                  onClick={startRecording}
                  className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/25 hover:bg-red-500/35 border border-red-500/50 text-red-500 transition-all active:scale-95"
                >
                  <Mic className="h-7 w-7" />
                </button>
              )}

              {recordingState === "recording" && (
                <div className="flex flex-col items-center gap-3">
                  <div className="relative flex items-center justify-center">
                    <span className="absolute inline-flex h-16 w-16 animate-ping rounded-full bg-red-500/30 opacity-75" />
                    <button
                      type="button"
                      onClick={stopRecording}
                      className="relative flex h-16 w-16 items-center justify-center rounded-full bg-red-500 text-white transition-all active:scale-95"
                    >
                      <div className="h-5 w-5 rounded bg-white" />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-red-400 font-medium">
                    <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                    Đang ghi âm: {formatDuration(duration)}
                  </div>
                </div>
              )}

              {recordingState === "review" && (
                <div className="flex flex-col items-center gap-4 w-full px-4">
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={playPreview}
                      className="flex h-12 w-12 items-center justify-center rounded-full bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-sky-400 transition-all active:scale-95"
                      title="Nghe thử"
                    >
                      {isPreviewPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 fill-current" />}
                    </button>
                    <button
                      type="button"
                      onClick={resetRecording}
                      className="flex h-12 w-12 items-center justify-center rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/70 transition-all active:scale-95"
                      title="Ghi âm lại"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                  <div className="text-xs text-white/50">Thời lượng: {formatDuration(duration)}</div>

                  {!isPreExisting && (
                    <div className="w-full text-left mt-2">
                      <label htmlFor="sample-text" className="block text-xs text-white/60 mb-1.5 font-medium">
                        Mô tả giọng nói (Bắt buộc)
                      </label>
                      <input
                        id="sample-text"
                        type="text"
                        placeholder="Ví dụ: Đây là giọng của Bách..."
                        value={sampleText}
                        onChange={(e) => setSampleText(e.target.value)}
                        className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/30 focus:border-sky-500 focus:outline-none"
                      />
                      <p className="text-[10px] text-white/40 mt-1">
                        Mẹo: Để chất lượng clone giọng tốt nhất, bạn nên nhập chính xác câu từ bạn đã nói trong file ghi âm.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {recordingState === "uploading" && (
                <div className="flex flex-col items-center gap-2 py-2">
                  <Loader2 className="h-8 w-8 text-sky-400 animate-spin" />
                  <div className="text-xs text-white/60">Đang tải lên và xử lý giọng nói...</div>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  resetRecording();
                  setIsAdding(false);
                }}
                disabled={recordingState === "uploading"}
                className="flex-1 rounded-lg border border-white/10 bg-white/5 py-2 text-sm font-medium hover:bg-white/10 disabled:opacity-50"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={recordingState !== "review"}
                className="flex-1 rounded-lg bg-sky-500 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:bg-sky-500/20 disabled:text-sky-300/40"
              >
                Lưu & Sử dụng
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

// Helpers for WAV encoding
function encodeWav(buffers: Float32Array[], sampleRate: number): Blob {
  const samples = mergeBuffers(buffers);
  const dataLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new Blob([view], { type: "audio/wav" });
}

function mergeBuffers(buffers: Float32Array[]): Float32Array {
  const totalLength = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const buffer of buffers) {
    merged.set(buffer, offset);
    offset += buffer.length;
  }
  return merged;
}

function writeString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}
