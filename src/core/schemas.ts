import { z } from 'zod';
import { Collection } from './contracts';

const name = z.string().min(1);
const key = z.string().min(1);

export const schemas: Record<Collection, z.AnyZodObject> = {
  locations: z.object({ providerId: key, name, slug: z.string().optional() }),
  restaurants: z.object({
    providerId: key,
    name,
    sourceRestaurantId: key.optional(),
    url: z.string().url().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    outletCode: z.string().optional(),
  }),
  service_areas: z.object({ restaurantKey: key, locationKey: key }),
  categories: z.object({ providerId: key, restaurantKey: key, name }),
  items: z.object({
    providerId: key,
    restaurantKey: key,
    name,
    description: z.string().optional(),
    priceMinor: z.number().int().nonnegative(),
    currency: z.literal('AED'),
    image: z.string().url().optional(),
  }),
  category_items: z.object({ categoryKey: key, itemKey: key }),
};
