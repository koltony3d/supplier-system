import { query } from "@/lib/db";

const PLACEHOLDER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#eef0f3"/><path d="M25 70l15-20 12 14 8-10 15 16z" fill="#c5cad3"/><circle cx="66" cy="34" r="7" fill="#c5cad3"/></svg>`;

export async function GET(_: Request, { params }: { params: Promise<{ sku: string }> }) {
  const { sku } = await params;
  const [img] = await query<{ mime: string; data: Buffer }>("SELECT mime, data FROM item_images WHERE sku=$1",
    [decodeURIComponent(sku)]);
  if (!img) return new Response(PLACEHOLDER, { headers: { "content-type": "image/svg+xml", "cache-control": "no-store" } });
  return new Response(new Uint8Array(img.data), { headers: { "content-type": img.mime, "cache-control": "no-store" } });
}
