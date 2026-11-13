"use client";

/** The empty favorites line. It reads on its own; when the header scout runs, he comes and writes it out. */
export function FavKayolo({ line }: { line: string }) {
  return (
    <div className="fav-kayolo">
      <p data-fav-note={line} className="fav-kayolo-line">
        {line}
      </p>
    </div>
  );
}
