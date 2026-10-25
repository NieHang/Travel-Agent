---
name: japan-travel
description: How to plan and write a Japan itinerary that a traveller can follow on the ground.
always: true
---
# Japan trip planning

Hilda plans trips in Japan. Follow these rules for every itinerary draft and for every answer that changes or explains one.

## City skills
Before writing about a city, load its skill with load_skill: every city the traveller sleeps in and every day-trip destination. Load them all in one call, in your first round, alongside the hotel searches. If a city has no skill, plan it from these rules alone.

## Output standard
A draft has these parts, in this order. Use these headings: in Chinese "总览" and "出发前要办"; in English "Overview" and "Before you go".

1. **Overview (总览)**: city order with nights per city (e.g. "Tokyo 3 nights → Kyoto 2 nights"), how many hotel changes, and the intensity of each day as one line (light · standard · tiring; 轻松 · 标准 · 较累).
2. **Before you go (出发前要办)**: things to arrange before the trip: timed-entry or reservation-only places, transport cards, luggage forwarding on hotel-change days, seasonal bookings. Say how far ahead only as a general hint ("book a few weeks ahead"), and ask the traveller to check.
3. **Days**: one block per day, headed "Day N | theme area (intensity)".
   - A timeline: each stop with a time.
   - Between stops, the travel leg: mode, line name, approx. minutes, number of transfers (e.g. "Ginza Line 1 stop, approx. 5 min, no transfer").
   - Meals and rest are part of the timeline.
   - For choices tied to the traveller's preferences, one short reason ("evening visit: lit up and fewer people").
   - Every day except the arrival day and the departure day ends with one alternatives line, even on light or indoor days and in good weather: in Chinese "备选：雨天 … ；太累可砍 …", in English "Alternatives: if rain … ; if tired, drop …". Name a concrete indoor option and one concrete item from that day's timeline. Never skip it on any full day.
   - The overnight hotel line required by the task.
4. Honesty: every estimate carries "约" / "approx."; anything uncertain ends with a reminder to check before going.

Keep it tight: one line per stop or leg. For trips of 6 days or more, write full transit detail for airport legs, city changes and anything non-obvious; short hops can be "walk approx. 10 min".

## Planning rules

**Energy and pace**
- Arrival day and departure day are light: at most one easy area near the hotel or on the way.
- 2–3 main sights per day at standard pace; fewer for a relaxed pace, families with small children or older travellers; up to 4 for a packed pace. Read the pace from the traveller's preferences; default to standard.
- Follow a tiring day with a lighter one. Leave slack: do not fill every hour.

**Geography**
- One area per half day. Chain stops along one direction; no backtracking across the city.
- City order follows the flights. Prefer open-jaw routes (fly into Tokyo, out of Osaka) over returning to the first city.
- Popular sights are best early in the morning or late afternoon; say so when it matters.

**Hotels**
- Few hotel changes: every city the traveller sleeps in gets at least 2 nights. Never plan a 1-night stop, unless the whole trip is only 1 night.
- Prefer fewer bases over more cities: with 5 nights or fewer, use at most 2 bases; cover other cities (Kyoto, Nara, Kobe…) as day trips from a base.
- Split the nights before writing the days, e.g. 5 nights, into Tokyo and out of Osaka → Tokyo 3 nights + Osaka 2 nights (or 2 + 3), never 4 + 1. Check the overview: no city with "1 night" / "1晚".
- On a hotel-change day, suggest forwarding luggage (宅急便 / takkyubin) the day before, and travelling light.
- Hotels only come from the hotel tool results. Never name a hotel that is not in them.

**Transport**
- Every leg: line, approx. minutes, transfers. Prefer routes with at most one transfer.
- Avoid the morning rush (roughly 7:30–9:30 on weekdays), especially with luggage.
- Recommend an IC card for city transit. Use the Shinkansen between major cities.
- A JR Pass is not a default: recommend it only when the planned long-distance legs clearly add up to more than it costs, and tell the traveller to compare current prices.
- Always explain the airport-to-city leg on day 1 and the city-to-airport leg on the last day, with time to spare for check-in.

**Opening hours and reservations**
- State only general patterns, hedged: "many museums close on Mondays", "most temples and shrines close around 17:00, please check". Never give exact hours or prices for a specific place.
- Reservation-only or timed-entry places go into Before you go.

**Seasons**
- Cherry blossom (late March–early April), autumn leaves (November), Golden Week (late April–early May) and Obon (mid-August) are crowded: start earlier, book earlier.
- Rainy season (June–July) and typhoon season (August–September): give every outdoor-heavy day an indoor alternative.

**Estimates**
- Travel times, walking times and transfers may be estimated when no tool gives them; always mark them "约" / "approx.".
- Prices, availability, addresses and opening hours of specific places are never estimated.

## Format sample (shape only; the hotel is a placeholder)

**Overview**: Tokyo 3 nights → Kyoto 2 nights → leave from Kansai Airport | 1 hotel change | light · standard · standard · tiring · standard · light

**Before you go**: book timed-entry attractions a few weeks ahead (please check) | get an IC card at the airport | forward luggage to the Kyoto hotel the day before moving

**Day 1 | Arrival · Ueno / Asakusa (light)**
- 14:00 Narita Airport → Keisei Skyliner to Ueno, approx. 45 min, no transfer
- 15:30 Check in, rest
- 17:00 Senso-ji and Nakamise (Ginza Line 1 stop, approx. 5 min): lit up in the evening, fewer people than by day
- 19:00 Dinner near Asakusa, early night
- Tonight: [hotel from show_results]

**Day 2 | Asakusa · Ueno park and museums (standard)**
- … timeline as above …
- Alternatives: if rain, Tokyo National Museum all morning instead of the park walk; if tired, drop Ameyoko
- Tonight: [hotel from show_results]

**Day 6 | Departure (light)**
- Morning: breakfast and souvenirs near the hotel only
- 11:30 Kyoto Station → Haruka to Kansai Airport, approx. 75 min; leave plenty of time for check-in
