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
  attendees: string[];
}

export function groupBookingsByEvent(bookings: BookingRow[]): GroupedBooking[] {
  return Object.values(
    bookings.reduce((acc: Record<string, GroupedBooking>, booking) => {
      const eventId = booking.events.id;

      if (!acc[eventId]) {
        acc[eventId] = {
          ...booking,
          attendees: [booking.guest_name],
        };
      } else {
        acc[eventId].attendees.push(booking.guest_name);
        if (booking.status === 'confirmed') acc[eventId].status = 'confirmed';
      }

      return acc;
    }, {}),
  );
}
