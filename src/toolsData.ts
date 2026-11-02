export interface Tool {
  id: string
  name: string
  emoji: string
  description: string
  url: string
  /** Tools that live inside Axion itself open a section instead of a link. */
  internal?: boolean
}

export const TOOLS: Tool[] = [
  {
    id: 'aura-studio',
    name: 'Aura Studio',
    emoji: '🎨',
    description: 'Edit images with AI — remove background, enhance, reimagine, plus reels and music.',
    url: '',
    internal: true,
  },
  {
    id: 'pixora-ai',
    name: 'Pixora AI',
    emoji: '✨',
    description: 'Open Pixora AI in a new tab.',
    url: 'https://deluxe-kelpie-851d9e.netlify.app/',
  },
]
