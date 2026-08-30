import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import type { SchemaContext } from 'astro:content';

/**
 * A photograph in a gallery band. `layout` decides how wide the tile sits in
 * the three column grid: `tall` takes one column, `wide` two, and two
 * consecutive `half` shots share one column as a stack.
 *
 * `caption` is shown in the viewer only, and may contain inline HTML so a
 * photo credit can link out.
 */
const shot = ({ image }: SchemaContext) =>
  z.object({
    src: image(),
    alt: z.string(),
    caption: z.string().optional(),
    layout: z.enum(['tall', 'wide', 'half']).default('tall')
  });

const projects = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/projects' }),
  schema: (ctx) =>
    z.object({
      /** Plain title for meta tags and the homepage link label */
      title: z.string(),
      /** The same title broken into the lines the hero should set */
      titleLines: z.array(z.string()),
      /** Sort order on the homepage, newest first */
      order: z.number(),
      description: z.string(),

      teaser: z.object({
        src: ctx.image(),
        alt: z.string(),
        text: z.string(),
        tags: z.array(z.string())
      }),

      /** Opening pull quote, borrowed from press or a collaborator */
      quote: z
        .object({
          text: z.string(),
          cite: z.string(),
          href: z.url().optional()
        })
        .optional(),

      lead: shot(ctx),
      facts: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
      gallery: z.array(shot(ctx)).default([]),

      video: z
        .object({
          provider: z.enum(['youtube', 'vimeo']),
          id: z.string(),
          title: z.string()
        })
        .optional(),

      /** Footnotes after the photographs. Inline HTML allowed for links. */
      notes: z.array(z.string()).default([])
    })
});

export const collections = { projects };
