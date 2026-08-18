"use client";

import { useState } from "react";
import { Hotel, MapPin, Star } from "lucide-react";
import { ServicePageHeader } from "@/components/dashboard/ServicePage";
import { Reveal } from "@/components/motion";
import { Input, Label } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { formatINR } from "@/lib/utils";

const hotels = [
  {
    name: "The Lalit New Delhi",
    area: "Connaught Place",
    rating: 4.6,
    price: 7499
  },
  { name: "Taj Palace", area: "Sardar Patel Marg", rating: 4.8, price: 12999 },
  { name: "Lemon Tree Premier", area: "Aerocity", rating: 4.4, price: 5499 },
  { name: "ibis New Delhi", area: "Aerocity", rating: 4.3, price: 4799 },
  { name: "Radisson Blu", area: "Paschim Vihar", rating: 4.5, price: 6299 },
  { name: "OYO Townhouse 1024", area: "Karol Bagh", rating: 4.1, price: 1899 }
];

export default function HotelPage() {
  const [city, setCity] = useState("New Delhi");
  const [checkin, setCheckin] = useState("");
  const [checkout, setCheckout] = useState("");
  const [searched, setSearched] = useState(false);

  return (
    <div>
      <Reveal distance={14} duration={0.4}>
        <ServicePageHeader
          icon={Hotel}
          title="Hotel Booking"
          description="50,000+ hotels across India at exclusive agent rates."
        />
      </Reveal>

      <Reveal distance={16} duration={0.45}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSearched(true);
        }}
        className="grid items-end gap-4 rounded-2xl border border-ink-100 bg-white p-6 shadow-sm lg:grid-cols-12"
      >
        <div className="lg:col-span-5">
          <Label>City / Hotel</Label>
          <Input value={city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="lg:col-span-3">
          <Label>Check-in</Label>
          <Input
            type="date"
            required
            value={checkin}
            onChange={(e) => setCheckin(e.target.value)}
          />
        </div>
        <div className="lg:col-span-3">
          <Label>Check-out</Label>
          <Input
            type="date"
            required
            value={checkout}
            onChange={(e) => setCheckout(e.target.value)}
          />
        </div>
        <div className="lg:col-span-1">
          <Button type="submit" size="lg" className="w-full">
            Search
          </Button>
        </div>
      </form>
      </Reveal>

      {searched && (
        <Reveal distance={16} duration={0.45} className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {hotels.map((h) => (
            <div
              key={h.name}
              className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-soft"
            >
              <div className="relative h-36 bg-gradient-to-br from-brand-100 via-brand-50 to-accent-100">
                <div className="absolute inset-0 bg-grid-pattern opacity-30" />
                <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-xs font-semibold text-amber-700">
                  <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                  {h.rating}
                </span>
              </div>
              <div className="p-5">
                <h4 className="font-display text-base font-semibold text-ink-900">
                  {h.name}
                </h4>
                <p className="mt-1 inline-flex items-center gap-1 text-xs text-ink-500">
                  <MapPin className="h-3 w-3" /> {h.area}, {city}
                </p>
                <div className="mt-4 flex items-end justify-between">
                  <div>
                    <p className="font-display text-xl font-bold text-ink-900">
                      {formatINR(h.price)}
                    </p>
                    <p className="text-xs text-ink-500">per night, incl. taxes</p>
                  </div>
                  <Button size="sm">Book</Button>
                </div>
              </div>
            </div>
          ))}
        </Reveal>
      )}
    </div>
  );
}
