"use client";

import { useState } from "react";
import { Bus } from "lucide-react";
import { ServicePageHeader } from "@/components/dashboard/ServicePage";
import { Panel } from "@/components/dashboard/ui";
import { Reveal } from "@/components/motion";
import { Input, Label, Select } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { formatINR } from "@/lib/utils";

const cities = [
  "Delhi",
  "Mumbai",
  "Bengaluru",
  "Chennai",
  "Hyderabad",
  "Pune",
  "Jaipur",
  "Kolkata",
  "Lucknow",
  "Chandigarh"
];

const buses = [
  { name: "VRL Travels", type: "AC Sleeper", depart: "21:30", arrive: "07:45", fare: 1199, seats: 12 },
  { name: "SRS Travels", type: "AC Semi-Sleeper", depart: "20:00", arrive: "07:00", fare: 899, seats: 8 },
  { name: "Orange Tours", type: "Volvo Multi-Axle", depart: "22:15", arrive: "08:30", fare: 1399, seats: 5 },
  { name: "RedBus Express", type: "Non-AC Seater", depart: "19:45", arrive: "06:30", fare: 599, seats: 22 }
];

export default function BusPage() {
  const [from, setFrom] = useState(cities[0]);
  const [to, setTo] = useState(cities[5]);
  const [date, setDate] = useState("");
  const [searched, setSearched] = useState(false);

  return (
    <div>
      <Reveal distance={14} duration={0.4}>
        <ServicePageHeader
          icon={Bus}
          title="Bus Booking"
          description="Book AC sleeper, semi-sleeper and seater buses across India."
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
        <div className="lg:col-span-4">
          <Label>From</Label>
          <Select value={from} onChange={(e) => setFrom(e.target.value)}>
            {cities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </div>
        <div className="lg:col-span-4">
          <Label>To</Label>
          <Select value={to} onChange={(e) => setTo(e.target.value)}>
            {cities.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </div>
        <div className="lg:col-span-3">
          <Label>Travel date</Label>
          <Input
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
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
        <Reveal distance={16} duration={0.45} className="mt-6 space-y-3">
          {buses.map((b) => (
            <Panel
              key={b.name}
              interactive
              className="flex flex-wrap items-center justify-between gap-4"
            >
              <div className="flex items-center gap-4">
                <span className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-soft">
                  <Bus className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-display text-base font-semibold text-ink-900">
                    {b.name}
                  </p>
                  <p className="text-xs text-ink-500">{b.type}</p>
                </div>
              </div>
              <div className="flex items-center gap-6 text-sm">
                <div>
                  <p className="font-display text-base font-bold text-ink-900">
                    {b.depart}
                  </p>
                  <p className="text-xs text-ink-500">{from}</p>
                </div>
                <div>
                  <p className="font-display text-base font-bold text-ink-900">
                    {b.arrive}
                  </p>
                  <p className="text-xs text-ink-500">{to}</p>
                </div>
                <div className="text-xs text-emerald-700">{b.seats} seats left</div>
              </div>
              <div className="text-right">
                <p className="font-display text-xl font-bold text-ink-900">
                  {formatINR(b.fare)}
                </p>
                <Button size="sm" className="mt-2">
                  Select seats
                </Button>
              </div>
            </Panel>
          ))}
        </Reveal>
      )}
    </div>
  );
}
