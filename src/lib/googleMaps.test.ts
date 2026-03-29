import { describe, expect, it } from 'vitest';
import {
  applyGoogleMapsAutofill,
  derivePublicLocationText,
  isGoogleMapsShortUrl,
  parseGoogleMapsLocation,
} from './googleMaps';

describe('googleMaps parsing', () => {
  it('detects shortened Google Maps links', () => {
    expect(isGoogleMapsShortUrl('https://maps.app.goo.gl/Sa6ZxvcibYrp8boh6?g_st=ic')).toBe(true);
    expect(isGoogleMapsShortUrl('https://www.google.com/maps/place/Hoi+An')).toBe(false);
  });

  it('parses a place URL into exact and public location text', () => {
    const parsed = parseGoogleMapsLocation(
      'https://www.google.com/maps/place/An+Bang+Beach,+Cam+An,+Hoi+An,+Quang+Nam,+Vietnam/@15.9274,108.3275,17z',
    );

    expect(parsed.exactLocation).toBe('An Bang Beach, Cam An, Hoi An, Quang Nam, Vietnam');
    expect(parsed.publicLocation).toBe('Hoi An, Quang Nam, Vietnam');
    expect(parsed.coordinates).toEqual({ lat: 15.9274, lng: 108.3275 });
  });

  it('parses a query URL into exact and public location text', () => {
    const parsed = parseGoogleMapsLocation(
      'https://www.google.com/maps/search/?api=1&query=123+Main+Street,+Fitzroy,+Melbourne,+Victoria,+Australia',
    );

    expect(parsed.exactLocation).toBe('123 Main Street, Fitzroy, Melbourne, Victoria, Australia');
    expect(parsed.publicLocation).toBe('Melbourne, Victoria, Australia');
  });

  it('returns no exact location when the URL only exposes coordinates', () => {
    const parsed = parseGoogleMapsLocation('https://www.google.com/maps/@15.9274,108.3275,17z');

    expect(parsed.exactLocation).toBeNull();
    expect(parsed.publicLocation).toBeNull();
    expect(parsed.coordinates).toEqual({ lat: 15.9274, lng: 108.3275 });
  });

  it('keeps existing manual values when parsing cannot fill a field', () => {
    const next = applyGoogleMapsAutofill(
      {
        google_maps_url: '',
        location_text: 'Manual meetup point',
        public_location_text: 'Hoi An',
      },
      parseGoogleMapsLocation('https://www.google.com/maps/@15.9274,108.3275,17z'),
    );

    expect(next.location_text).toBe('Manual meetup point');
    expect(next.public_location_text).toBe('Hoi An');
    expect(next.google_maps_url).toContain('google.com/maps/@15.9274,108.3275,17z');
  });

  it('rejects non-Google Maps links', () => {
    expect(() => parseGoogleMapsLocation('https://example.com/place/test')).toThrow(
      'Please use a Google Maps share link.',
    );
  });

  it('derives a softer public location from a detailed exact location', () => {
    expect(derivePublicLocationText('Cafe ABC, 123 Main Street, Fitzroy, Melbourne, Victoria, Australia'))
      .toBe('Melbourne, Victoria, Australia');
  });

  it('derives a public area from a venue-style name that ends with a city', () => {
    expect(derivePublicLocationText('Casamia Calm Hoi An')).toBe('Hoi An');
  });

  it('avoids guessing a public area from short venue-style names', () => {
    expect(derivePublicLocationText('An Bang Beach')).toBeNull();
  });
});
