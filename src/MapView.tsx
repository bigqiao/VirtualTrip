import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { Location } from "./types";
export default function MapView({
  location,
  onPick,
}: {
  location: Location;
  onPick: (l: Location) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    if (!element.current) return;
    const instance = L.map(element.current, { zoomControl: false }).setView(
      [location.lat, location.lng],
      13,
    );
    map.current = instance;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(instance);
    L.control.zoom({ position: "bottomright" }).addTo(instance);
    marker.current = L.marker([location.lat, location.lng], {
      icon: L.divIcon({
        className: "trip-map-pin",
        html: "<span></span>",
        iconSize: [34, 44],
        iconAnchor: [17, 42],
      }),
    }).addTo(instance);
    instance.on("click", (event: L.LeafletMouseEvent) => {
      const { lat, lng } = event.latlng;
      pick.current({
        lat,
        lng,
        name: `地图选点 · ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
      });
    });
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      instance.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    map.current?.flyTo(
      [location.lat, location.lng],
      Math.max(map.current.getZoom(), 12),
      { duration: 0.6 },
    );
    marker.current?.setLatLng([location.lat, location.lng]);
  }, [location.lat, location.lng]);
  return (
    <div
      ref={element}
      className="map-view"
      aria-label="点击地图选择旅行目的地"
    />
  );
}
