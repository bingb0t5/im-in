-- Seed data for 3 example events
-- Note: You'll need to replace 'YOUR_USER_ID' with your actual Supabase Auth User ID if you want to see these in your dashboard.

INSERT INTO public.events (slug, title, description, location_text, starts_at, capacity, host_name, allow_waitlist)
VALUES 
('yoga-in-the-park', 'Yoga in the Park', 'Join us for a relaxing morning yoga session. Bring your own mat!', 'Central Park, North Meadow', now() + interval '2 days', 15, 'Sarah Miller', true),
('tech-meetup-coffee', 'Tech & Coffee', 'Casual meetup for developers and designers to talk shop.', 'The Daily Grind Cafe', now() + interval '5 days', 8, 'David Chen', true),
('board-game-night', 'Board Game Night', 'Weekly board game night. We have Catan, Ticket to Ride, and more!', '123 Maple St, Apt 4B', now() + interval '1 week', 6, 'Alex Rivera', false);
