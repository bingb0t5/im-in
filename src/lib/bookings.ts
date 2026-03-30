export interface BookingRow {
  status: 'confirmed' | 'waitlist' | 'cancelled' | string;
  guest_name: string;
  events: {
    id: string;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface GroupedBooking extends BookingRow {
  attendees: Array<{
    name: string;
    status: string;
  }>;
}

export function groupBookingsByEvent(bookings: BookingRow[]): GroupedBooking[] {
  return Object.values(
    bookings.reduce((acc: Record<string, GroupedBooking>, booking) => {
      const eventId = booking.events.id;

      if (!acc[eventId]) {
        acc[eventId] = {
          ...booking,
          attendees: [{ name: booking.guest_name, status: booking.status }],
        };
      } else {
        acc[eventId].attendees.push({ name: booking.guest_name, status: booking.status });
        if (booking.status === 'confirmed') {
          acc[eventId].status = 'confirmed';
        } else if (booking.status === 'waitlist' && acc[eventId].status !== 'confirmed') {
          acc[eventId].status = 'waitlist';
        }
      }

      return acc;
    }, {}),
  );
}
