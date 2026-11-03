import Image from "next/image";
import type { CSSProperties } from "react";

// The real pixel sizes of public/photos, so the browser reserves the right space before each one loads.
const SIZE: Record<string, [number, number]> = {
  "/photos/barber-1.jpg": [896, 1200],
  "/photos/barber-2.jpg": [896, 1200],
  "/photos/beard.jpg": [1200, 896],
  "/photos/bench.jpg": [1200, 896],
  "/photos/fade.jpg": [1024, 1024],
  "/photos/jar.jpg": [896, 1200],
  "/photos/scissors.jpg": [1100, 896],
  "/photos/shop.jpg": [1376, 768],
  "/photos/shopfront.jpg": [1200, 896],
  "/photos/towel.jpg": [1200, 896],
};

export const SHOP_ALT = "Marek and Ailsa both mid-cut while a customer waits on the bench with a paperback. AI-generated.";

export function Photo(props: { src: string; alt: string; sizes: string; className?: string; style?: CSSProperties }) {
  const [width, height] = SIZE[props.src] ?? [1200, 900];
  return <Image src={props.src} alt={props.alt} width={width} height={height} sizes={props.sizes} quality={85} className={props.className} style={props.style} />;
}
