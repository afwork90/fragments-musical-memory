"use client";

import { ReactNode, useMemo } from "react";
import type { Fragment } from "@/lib/view/fragment";
import type { SourceFile } from "@/lib/view/source-file";
import { EditableRange } from "../../fragmentation-workbench";
import { visibleSources } from "./source-list";
import { SourceTable } from "./source-table";
import { SourcesToolbar } from "./sources-toolbar";
import { SourceSort } from "./types";

type SourcesViewProps = {
  sources: SourceFile[];
  sourceRanges: Record<string, EditableRange[]>;
  selectedSourceId: string;
  editorOpen: boolean;
  editorModal: boolean;
  importComplete: boolean;
  previewingId: string | null;
  query: string;
  sort: SourceSort;
  onQueryChange: (query: string) => void;
  onSortChange: (sort: SourceSort) => void;
  onImportClick: () => void;
  onSelectSource: (sourceId: string) => void;
  onOpenFragmentation: (sourceId: string) => void;
  onPreviewFragment: (fragment: Fragment) => void;
  onPreviewSource: (source: SourceFile) => void;
  onRemoveSource: (sourceId: string) => void;
  onDeleteSource: (sourceId: string) => void;
  canDeleteFiles: boolean;
  getFragmentById: (id: string) => Fragment;
  editorPanel: ReactNode;
};

export function SourcesView({
  sources,
  sourceRanges,
  selectedSourceId,
  editorOpen,
  editorModal,
  importComplete,
  previewingId,
  query,
  sort,
  onQueryChange,
  onSortChange,
  onImportClick,
  onSelectSource,
  onOpenFragmentation,
  onPreviewFragment,
  onPreviewSource,
  onRemoveSource,
  onDeleteSource,
  canDeleteFiles,
  getFragmentById,
  editorPanel,
}: SourcesViewProps) {
  const filteredSources = useMemo(
    () => visibleSources(sources, query, sort),
    [sources, query, sort],
  );

  return (
    <section className="page-view source-page">
      <div className={`source-workspace ${editorOpen && !editorModal ? "editor-open" : ""}`}>
        <div className="sources-panel">
          <SourcesToolbar
            importComplete={importComplete}
            query={query}
            onQueryChange={onQueryChange}
            onImportClick={onImportClick}
          />
          <div className="sources-scroll">
            <SourceTable
              sources={filteredSources}
              sourceRanges={sourceRanges}
              selectedSourceId={selectedSourceId}
              editorOpen={editorOpen}
              previewingId={previewingId}
              sort={sort}
              onSortChange={onSortChange}
              onSelectSource={onSelectSource}
              onOpenFragmentation={onOpenFragmentation}
              onPreviewFragment={onPreviewFragment}
              onPreviewSource={onPreviewSource}
              onRemoveSource={onRemoveSource}
              onDeleteSource={onDeleteSource}
              canDeleteFiles={canDeleteFiles}
              getFragmentById={getFragmentById}
            />
          </div>
        </div>
        {editorOpen && !editorModal && editorPanel}
      </div>
    </section>
  );
}
