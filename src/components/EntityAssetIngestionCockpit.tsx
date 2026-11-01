// src/components/EntityAssetIngestionCockpit.tsx
// Phase 1.5 Ingestion Tool: Displays AI-detected entities requiring images,
// renames user uploads to the AI's canonical filenames, measures exact pixel dimensions in browser,
// and saves assets to local IndexedDB & disk storage without sending image bytes to the LLM.

import { useState, useRef, type ChangeEvent, type DragEvent } from "react";
import type { EntityImageRequirement, UploadedImageAsset } from "../sdk/contract.generated";
import { saveProjectAsset, deleteProjectAsset } from "../services/projects";
import {
  Upload,
  CheckCircle2,
  Trash2,
  Sparkles,
  ArrowRight,
  Maximize2,
  Plus,
  X,
} from "lucide-react";

export function EntityAssetIngestionCockpit({
  projectId,
  entities,
  uploadedAssets,
  onAssetUploaded,
  onAssetRemoved,
  onAddCustomEntity,
  onProceed,
  onSkipAll,
  isProcessing = false,
}: {
  projectId: string;
  entities: EntityImageRequirement[];
  uploadedAssets: UploadedImageAsset[];
  onAssetUploaded: (asset: UploadedImageAsset) => void;
  onAssetRemoved: (assetId: string) => void;
  onAddCustomEntity?: (custom: EntityImageRequirement) => void;
  onProceed: () => void;
  onSkipAll?: () => void;
  isProcessing?: boolean;
}) {
  const [uploadingEntityId, setUploadingEntityId] = useState<string | null>(null);
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const [showAddCustom, setShowAddCustom] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customCategory, setCustomCategory] = useState<EntityImageRequirement["category"]>("person");
  const [customRationale, setCustomRationale] = useState("");
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const assetMap = new Map<string, UploadedImageAsset>();
  for (const a of uploadedAssets) {
    assetMap.set(a.id, a);
  }

  const handleProcessFile = async (entity: EntityImageRequirement, file: File) => {
    if (!file.type.startsWith("image/")) {
      alert("Please upload an image file (PNG, JPG, WEBP, or SVG).");
      return;
    }

    setUploadingEntityId(entity.id);
    try {
      // 1. Determine standardized extension & canonical filename
      const extMatch = file.name.match(/\.[a-zA-Z0-9]+$/);
      let ext = (extMatch ? extMatch[0] : ".png").toLowerCase();
      if (ext === ".jpeg") ext = ".jpg";
      const standardizedFilename = `${entity.targetFilename}${ext}`;

      // 2. Measure dimensions & aspect ratio in browser
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to decode image dimensions."));
        img.src = objectUrl;
      });

      const width = img.naturalWidth || 1920;
      const height = img.naturalHeight || 1080;
      const aspectRatio = width / Math.max(1, height);

      let aspectRatioLabel = "custom";
      if (Math.abs(aspectRatio - 1) < 0.08) aspectRatioLabel = "1:1 square";
      else if (Math.abs(aspectRatio - 16 / 9) < 0.12) aspectRatioLabel = "16:9 landscape";
      else if (Math.abs(aspectRatio - 4 / 3) < 0.1) aspectRatioLabel = "4:3 landscape";
      else if (Math.abs(aspectRatio - 9 / 16) < 0.12) aspectRatioLabel = "9:16 vertical";
      else if (Math.abs(aspectRatio - 3 / 4) < 0.1) aspectRatioLabel = "3:4 portrait";
      else if (aspectRatio < 0.88) aspectRatioLabel = "portrait";
      else if (aspectRatio > 1.15) aspectRatioLabel = "landscape";

      // 3. Save to local IndexedDB & mirror to Vite disk backend
      await saveProjectAsset(projectId, standardizedFilename, file);

      const asset: UploadedImageAsset = {
        id: entity.id,
        entityName: entity.name,
        originalFilename: file.name,
        standardizedFilename,
        url: objectUrl,
        mimeType: file.type || "image/jpeg",
        width,
        height,
        aspectRatio,
        aspectRatioLabel,
        fileSizeBytes: file.size,
        uploadedAt: Date.now(),
      };

      onAssetUploaded(asset);
    } catch (err) {
      console.error("Failed to profile and save image asset:", err);
      alert(`Could not process image: ${(err as Error).message}`);
    } finally {
      setUploadingEntityId(null);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, entity: EntityImageRequirement) => {
    e.preventDefault();
    setDragActiveId(null);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void handleProcessFile(entity, file);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>, entity: EntityImageRequirement) => {
    const file = e.target.files?.[0];
    if (file) {
      void handleProcessFile(entity, file);
    }
    e.target.value = "";
  };

  const handleRemove = async (asset: UploadedImageAsset) => {
    await deleteProjectAsset(projectId, asset.standardizedFilename);
    onAssetRemoved(asset.id);
  };

  const handleCreateCustom = () => {
    if (!customName.trim()) return;
    const slug = customName.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
    const custom: EntityImageRequirement = {
      id: slug || `custom_${Date.now()}`,
      name: customName.trim(),
      targetFilename: slug || `custom_${Date.now()}`,
      category: customCategory,
      rationale: customRationale.trim() || "User-added custom visual asset",
      suggestedFraming: "portrait",
      importance: "optional",
      sentenceIndices: [],
      cleverFallbackIdea: "Stylized vector heraldic badge and serif monogram",
    };
    onAddCustomEntity?.(custom);
    setCustomName("");
    setCustomRationale("");
    setShowAddCustom(false);
  };

  const totalEntities = entities.length;
  const uploadedCount = uploadedAssets.length;

  return (
    <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-6 shadow-sm">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 pb-5 border-b border-[color:var(--color-border)]">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 font-mono text-[10px] uppercase font-bold tracking-wider">
              Phase 1.5 · Asset Ingestion
            </span>
            <span className="text-xs text-[color:var(--color-text-faint)] font-mono">
              {uploadedCount} / {totalEntities} assets uploaded
            </span>
          </div>
          <h3 className="text-xl font-bold text-[color:var(--color-text)]">
            Entity Visual Assets (Optional)
          </h3>
          <p className="text-xs text-[color:var(--color-text-soft)] max-w-2xl mt-1 leading-relaxed">
            AI analyzed your narration and found <strong>{totalEntities} visual entities</strong>. 
            Upload images so viewers instantly recognize who or what is being discussed. 
            If any image is skipped, the AI will choreograph <em>clever vector monograms, heraldic emblems, or classified dossier cards</em> instead.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {onSkipAll && (
            <button
              onClick={onSkipAll}
              disabled={isProcessing}
              className="px-3.5 py-2 rounded-xl border border-[color:var(--color-border)] hover:bg-[color:var(--color-surface-3)] text-[color:var(--color-text-soft)] text-xs font-semibold transition-colors cursor-pointer"
            >
              Skip All & Proceed
            </button>
          )}
          <button
            onClick={onProceed}
            disabled={isProcessing}
            className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-600/20 flex items-center gap-2 transition-all cursor-pointer"
          >
            <span>Proceed to Storyboard Planning</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Entity Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-5">
        {entities.map((entity) => {
          const uploaded = assetMap.get(entity.id);
          const isDragging = dragActiveId === entity.id;
          const isUploading = uploadingEntityId === entity.id;

          return (
            <div
              key={entity.id}
              className={`rounded-xl border transition-all flex flex-col overflow-hidden ${
                uploaded
                  ? "border-emerald-500/40 bg-emerald-500/[0.03]"
                  : isDragging
                  ? "border-blue-500 bg-blue-500/5 ring-2 ring-blue-500/30"
                  : "border-[color:var(--color-border)] bg-[color:var(--color-surface-2)]"
              }`}
            >
              {/* Card Top: Entity info */}
              <div className="p-3.5 pb-2">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="font-semibold text-sm text-[color:var(--color-text)] truncate" title={entity.name}>
                    {entity.name}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[9px] font-mono uppercase font-bold tracking-wider bg-[color:var(--color-surface-3)] text-[color:var(--color-text-faint)]">
                    {entity.category}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 font-mono text-[10px] text-[color:var(--color-text-faint)] mb-2">
                  <span>Slug:</span>
                  <code className="text-blue-500 font-bold">{entity.targetFilename}</code>
                  <span className="opacity-40">·</span>
                  <span className="capitalize">{entity.suggestedFraming}</span>
                </div>

                <p className="text-[11px] text-[color:var(--color-text-soft)] line-clamp-2 leading-relaxed">
                  {entity.rationale}
                </p>
              </div>

              {/* Card Bottom: Upload preview or dropzone */}
              <div className="mt-auto p-3 pt-1">
                {uploaded ? (
                  <div className="rounded-lg border border-emerald-500/30 bg-[color:var(--color-surface)] p-2.5 flex items-center gap-3">
                    <div className="w-14 h-14 rounded-md overflow-hidden bg-black/40 border border-white/10 shrink-0 relative group">
                      <img src={uploaded.url} alt={uploaded.entityName} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        <Maximize2 className="w-4 h-4 text-white" />
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-mono text-[10px] font-bold">
                        <CheckCircle2 className="w-3 h-3 shrink-0" />
                        <span className="truncate">{uploaded.standardizedFilename}</span>
                      </div>
                      <div className="font-mono text-[10px] text-[color:var(--color-text-faint)] mt-0.5">
                        {uploaded.width}×{uploaded.height} · {uploaded.aspectRatioLabel}
                      </div>
                      <div className="text-[9px] text-[color:var(--color-text-faint)] truncate mt-0.5">
                        Renamed from {uploaded.originalFilename}
                      </div>
                    </div>
                    <button
                      onClick={() => void handleRemove(uploaded)}
                      title="Remove image"
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-[color:var(--color-text-faint)] hover:text-red-500 transition-colors shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragActiveId(entity.id); }}
                    onDragLeave={() => setDragActiveId(null)}
                    onDrop={(e) => handleDrop(e, entity)}
                    onClick={() => fileInputs.current[entity.id]?.click()}
                    className={`rounded-lg border-2 border-dashed p-3.5 text-center cursor-pointer transition-colors flex flex-col items-center justify-center min-h-[92px] ${
                      isDragging
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-[color:var(--color-border)] hover:border-blue-500/60 hover:bg-blue-500/5"
                    }`}
                  >
                    <input
                      ref={(el) => { fileInputs.current[entity.id] = el; }}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => handleFileChange(e, entity)}
                    />
                    {isUploading ? (
                      <div className="flex items-center gap-2 text-xs font-medium text-blue-500">
                        <span className="w-3.5 h-3.5 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                        Profiling & renaming...
                      </div>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 text-[color:var(--color-text-faint)] mb-1" />
                        <div className="text-xs font-semibold text-[color:var(--color-text)]">
                          Drop image or browse
                        </div>
                        <div className="text-[10px] text-[color:var(--color-text-faint)] mt-0.5">
                          Renames to <code className="text-blue-500 font-bold">{entity.targetFilename}.*</code>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Missing fallback notification when no image is uploaded */}
                {!uploaded && (
                  <div className="mt-1.5 flex items-start gap-1 text-[10px] text-[color:var(--color-text-faint)] leading-tight px-1">
                    <Sparkles className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                    <span>Fallback: {entity.cleverFallbackIdea}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {/* Add Custom Entity Button / Form */}
        <div className="rounded-xl border border-dashed border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4 flex flex-col justify-center min-h-[200px]">
          {showAddCustom ? (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-xs text-[color:var(--color-text)]">Add Custom Entity</span>
                <button onClick={() => setShowAddCustom(false)} className="text-[color:var(--color-text-faint)] hover:text-[color:var(--color-text)]">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <input
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="Entity name (e.g. Saladin, Apple Watch)"
                className="w-full px-2.5 py-1.5 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] text-xs text-[color:var(--color-text)]"
              />
              <select
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value as any)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] text-xs text-[color:var(--color-text)]"
              >
                <option value="person">Person / Figure</option>
                <option value="historical">Historical Figure</option>
                <option value="product">Product / Hardware</option>
                <option value="organization">Organization / Company</option>
                <option value="location">Location / Landmark</option>
                <option value="object">Object / Relic</option>
              </select>
              <input
                value={customRationale}
                onChange={(e) => setCustomRationale(e.target.value)}
                placeholder="Why an image helps (optional)"
                className="w-full px-2.5 py-1.5 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)] text-xs text-[color:var(--color-text)]"
              />
              <button
                onClick={handleCreateCustom}
                disabled={!customName.trim()}
                className="w-full py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold disabled:opacity-40"
              >
                Add Entity Card
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAddCustom(true)}
              className="flex flex-col items-center justify-center gap-2 text-[color:var(--color-text-faint)] hover:text-blue-500 py-6 transition-colors cursor-pointer"
            >
              <div className="w-8 h-8 rounded-full border border-dashed border-current flex items-center justify-center">
                <Plus className="w-4 h-4" />
              </div>
              <span className="text-xs font-semibold">Add Another Entity Asset</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
