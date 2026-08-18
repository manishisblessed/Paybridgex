"use client";

import { useState } from "react";
import { Plane, ArrowRightLeft } from "lucide-react";
import { ServicePageHeader } from "@/components/dashboard/ServicePage";
import { Panel, SectionTitle } from "@/components/dashboard/ui";
import { Reveal } from "@/components/motion";
import { Input, Label, Select } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { formatINR } from "@/lib/utils";

const cities = [
  "DEL · Delhi",
  "BOM · Mumbai",
  "BLR · Bengaluru",
  "MAA · Chennai",
  "CCU · Kolkata",
  "HYD · Hyderabad",
  "GOI · Goa",
  "PNQ · Pune",
  "AMD · Ahmedabad",
  "JAI · Jaipur"
];

type Flight = {
  airline: string;
  flightNo: string;
  depart: string;
  arrive: string;
  duration: string;
  fare: number;
  stops: string;
};

const sampleFlights: Flight[] = [
  {
    airline: "IndiGo",
    flightNo: "6E-2031",
    depart: "06:15",
    arrive: "08:45",
    duration: "2h 30m",
    fare: 4299,
    stops: "Non-stop"
  },
  {
    airline: "Air India",
    flightNo: "AI-805",
    depart: "08:50",
    arrive: "11:25",
    duration: "2h 35m",
    fare: 4799,
    stops: "Non-stop"
  },
  {
    airline: "Vistara",
    flightNo: "UK-995",
    depart: "13:10",
    arrive: "15:55",
    duration: "2h 45m",
    fare: 5299,
    stops: "Non-stop"
  },
  {
    airline: "SpiceJet",
    flightNo: "SG-160",
    depart: "18:35",
    arrive: "21:15",
    duration: "2h 40m",
    fare: 3899,
    stops: "Non-stop"
  }
];

export default function FlightPage() {
  const [from, setFrom] = useState(cities[0]);
  const [to, setTo] = useState(cities[2]);
  const [date, setDate] = useState("");
  const [pax, setPax] = useState(1);
  const [searched, setSearched] = useState(false);

  function swap() {
    setFrom(to);
    setTo(from);
  }

  return (
    <div>
      <Reveal distance={14} duration={0.4}>
        <ServicePageHeader
          icon={Plane}
          title="Flight Booking"
          description="Search and book domestic flights with the best agent fares."
        />
      </Reveal>

      <Reveal distance={16} duration={0.45}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSearched(true);
        }}
        className="rounded-2xl border border-ink-100 bg-white p-6 shadow-sm"
      >
        <div className="grid items-end gap-4 lg:grid-cols-12">
          <div className="lg:col-span-3">
            <Label>From</Label>
            <Select value={from} onChange={(e) => setFrom(e.target.value)}>
              {cities.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </div>
          <div className="lg:col-span-1 flex items-center justify-center pb-1">
            <button
              type="button"
              onClick={swap}
              aria-label="Swap"
              className="grid h-10 w-10 place-items-center rounded-full border border-ink-200 bg-white text-ink-700 shadow-sm transition-all duration-150 hover:border-brand-300 hover:text-brand-700 hover:shadow-soft"
            >
              <ArrowRightLeft className="h-4 w-4" />
            </button>
          </div>
          <div className="lg:col-span-3">
            <Label>To</Label>
            <Select value={to} onChange={(e) => setTo(e.target.value)}>
              {cities.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </div>
          <div className="lg:col-span-2">
            <Label>Departure</Label>
            <Input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="lg:col-span-2">
            <Label>Travellers</Label>
            <Select value={pax} onChange={(e) => setPax(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} {n > 1 ? "Adults" : "Adult"}
                </option>
              ))}
            </Select>
          </div>
          <div className="lg:col-span-1">
            <Button type="submit" size="lg" className="w-full">
              Search
            </Button>
          </div>
        </div>
      </form>
      </Reveal>

      {searched && (
        <Reveal distance={16} duration={0.45} className="mt-6 space-y-3">
          <SectionTitle
            className="mb-0"
            title={
              <>
                {sampleFlights.length} flights found · {from.split(" · ")[0]} →{" "}
                {to.split(" · ")[0]}
              </>
            }
          />
          {sampleFlights.map((f) => (
            <Panel
              key={f.flightNo}
              interactive
              className="flex flex-wrap items-center justify-between gap-4"
            >
              <div className="flex items-center gap-4">
                <span className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-soft">
                  <Plane className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-display text-sm font-semibold text-ink-900">
                    {f.airline}
                  </p>
                  <p className="text-xs text-ink-500">{f.flightNo}</p>
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm">
                <div className="text-right">
                  <p className="font-display text-lg font-bold text-ink-900">
                    {f.depart}
                  </p>
                  <p className="text-xs text-ink-500">{from.split(" · ")[0]}</p>
                </div>
                <div className="flex flex-col items-center text-xs text-ink-500">
                  <span>{f.duration}</span>
                  <span className="my-1 h-px w-16 bg-ink-200" />
                  <span>{f.stops}</span>
                </div>
                <div>
                  <p className="font-display text-lg font-bold text-ink-900">
                    {f.arrive}
                  </p>
                  <p className="text-xs text-ink-500">{to.split(" · ")[0]}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-display text-xl font-bold text-ink-900">
                  {formatINR(f.fare * pax)}
                </p>
                <p className="text-xs text-ink-500">
                  for {pax} {pax > 1 ? "travellers" : "traveller"}
                </p>
                <Button size="sm" className="mt-2">
                  Book
                </Button>
              </div>
            </Panel>
          ))}
        </Reveal>
      )}
    </div>
  );
}
