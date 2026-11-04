/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileType,
  FileVideo,
  Presentation,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@plane/utils";

type TKind = { label: string; icon: LucideIcon; color: string };

const KINDS: Record<string, TKind> = {
  pdf: { label: "PDF", icon: FileText, color: "#dc2626" },
  doc: { label: "Document", icon: FileText, color: "#2563eb" },
  sheet: { label: "Spreadsheet", icon: FileSpreadsheet, color: "#16a34a" },
  slides: { label: "Slides", icon: Presentation, color: "#ea580c" },
  image: { label: "Image", icon: FileImage, color: "#9333ea" },
  video: { label: "Video", icon: FileVideo, color: "#db2777" },
  audio: { label: "Audio", icon: FileAudio, color: "#0d9488" },
  archive: { label: "Archive", icon: FileArchive, color: "#ca8a04" },
  code: { label: "Code", icon: FileCode, color: "#475569" },
  text: { label: "Text", icon: FileType, color: "#64748b" },
  cad: { label: "Drawing", icon: File, color: "#0891b2" },
  other: { label: "File", icon: File, color: "#6b7280" },
};

const EXTENSIONS: Record<string, keyof typeof KINDS> = {
  pdf: "pdf",
  doc: "doc",
  docx: "doc",
  odt: "doc",
  rtf: "doc",
  pages: "doc",
  xls: "sheet",
  xlsx: "sheet",
  ods: "sheet",
  csv: "sheet",
  tsv: "sheet",
  numbers: "sheet",
  ppt: "slides",
  pptx: "slides",
  odp: "slides",
  key: "slides",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  heic: "image",
  bmp: "image",
  tif: "image",
  tiff: "image",
  mp4: "video",
  mov: "video",
  webm: "video",
  mkv: "video",
  avi: "video",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  ogg: "audio",
  flac: "audio",
  zip: "archive",
  rar: "archive",
  "7z": "archive",
  tar: "archive",
  gz: "archive",
  json: "code",
  xml: "code",
  yml: "code",
  yaml: "code",
  js: "code",
  ts: "code",
  py: "code",
  sql: "code",
  html: "code",
  css: "code",
  md: "text",
  txt: "text",
  log: "text",
  dwg: "cad",
  dxf: "cad",
  step: "cad",
  stp: "cad",
  stl: "cad",
};

/** What kind of file a name is, for its icon and color. */
export const fileKind = (name: string): TKind => {
  const extension = name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";
  return KINDS[EXTENSIONS[extension] ?? "other"];
};

export const fileExtension = (name: string) => (name.includes(".") ? (name.split(".").pop() ?? "").toUpperCase() : "");

/** A colored icon that says at a glance whether a file is a PDF, a sheet, a picture and so on. */
export function FileTypeIcon({ name, className }: { name: string; className?: string }) {
  const kind = fileKind(name);
  const Icon = kind.icon;
  return (
    <span
      aria-hidden
      className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-md", className)}
      style={{ backgroundColor: `color-mix(in oklab, ${kind.color} 16%, transparent)`, color: kind.color }}
    >
      <Icon className="size-4" />
    </span>
  );
}
