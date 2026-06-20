import Link from "next/link";
import type { NavTile } from "@civitasone/types";

interface LinkTilesProps {
  tiles: NavTile[];
  columns?: "three" | "four";
}

export function LinkTiles({ tiles, columns = "three" }: LinkTilesProps) {
  const columnClass = columns === "four" ? "lg:grid-cols-4" : "lg:grid-cols-3";

  return (
    <div className={`grid gap-3 sm:grid-cols-2 ${columnClass}`}>
      {tiles.map((tile) => (
        <Link
          key={tile.href}
          href={tile.href}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <h2 className="text-base font-semibold text-slate-900">{tile.title}</h2>
          {tile.description ? <p className="mt-1 text-sm text-slate-600">{tile.description}</p> : null}
        </Link>
      ))}
    </div>
  );
}
