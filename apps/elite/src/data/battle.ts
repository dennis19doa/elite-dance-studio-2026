const startsAt = "11:00";
const endsAt = "19:00";

export const battle = {
  startsAt,
  endsAt,
  hours: `${startsAt}–${endsAt}`,
  onlineFee: "5 €",
  doorFee: "8 €",
  poster: {
    small: "media/events/elite-dance-battle-2026-480.jpg",
    large: "media/events/elite-dance-battle-2026-1120.jpg",
    smallWidth: 480,
    width: 1120,
    height: 1400,
  },
  eversportsBookingUrl: "https://www.eversports.de/org/activity/946397ed-f7ae-4ea1-8ee1-2e985945d6f1",
  uscBookingUrl: "https://urbansportsclub.com/de/venues/elite-dance-studio-1",
  categoryNames: {
    "breaking-kids": "Breaking Kids",
    breaking: "Breaking Adults",
    house: "House",
    "hip-hop": "Hip-Hop",
  },
};
