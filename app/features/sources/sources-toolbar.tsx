import { Button } from "@/components/ui/button";

type SourcesToolbarProps = {
  importComplete: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  onImportClick: () => void;
};

export function SourcesToolbar({ importComplete, query, onQueryChange, onImportClick }: SourcesToolbarProps) {
  return (
    <div className="sources-toolbar">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="import-button h-[30px] border-[#74d8ff8c] bg-[#74d8ff18] text-[#9ce5ff] hover:bg-[#74d8ff] hover:text-[#0d1519]"
        onClick={onImportClick}
      >
        {importComplete ? "✓ Imported" : "＋ Import"}
      </Button>
      <label className="search">
        <span aria-hidden="true">⌕</span>
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search"
          aria-label="Search sources"
        />
      </label>
    </div>
  );
}
