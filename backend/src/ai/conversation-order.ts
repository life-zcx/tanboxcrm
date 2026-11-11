export interface OrderedMessage {
  sender: 'CLIENT' | 'MANAGER';
  senderName?: string;
  content: string;
  time?: string;
}

export interface PositionedScreenshotMessage extends Omit<OrderedMessage, 'sender'> {
  side: 'LEFT' | 'RIGHT';
}

export function assignScreenshotSenders(screenshots: {imageIndex:number;messages:PositionedScreenshotMessage[]}[]) {
  return screenshots.map(screen=>({imageIndex:screen.imageIndex,messages:screen.messages.map(({side,...message})=>({
    ...message,
    content:message.content.replace(/^(Пропущенный (?:аудио|видео)звонок)\s*\n\s*Нажмите, чтобы перезвонить\s*$/i,'$1'),
    sender:side==='LEFT'?'CLIENT' as const:'MANAGER' as const,
  }))}));
}

function normalized(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('ru-RU')
    .replace(/[«»“”]/g, '"').replace(/[\u200b\u00ad]/g, '')
    .replace(/\s+/g, ' ').trim();
}

function sameMessage(a: OrderedMessage, b: OrderedMessage) {
  if (a.sender !== b.sender || normalized(a.content) !== normalized(b.content)) return false;
  // Different visible times mean different messages even when the text repeats.
  return !a.time || !b.time || normalized(a.time) === normalized(b.time);
}

/** Preserve screenshot order and top-to-bottom message order. Clock-only times
 * cannot be globally sorted: a conversation may cross midnight or several days.
 * Remove only a contiguous overlap at the boundary, never global repetitions. */
export function mergeScreenshotMessages(screenshots: { imageIndex: number; messages: OrderedMessage[] }[], imageCount: number) {
  const indices = screenshots.map(s => s.imageIndex);
  if (screenshots.length !== imageCount || new Set(indices).size !== imageCount || indices.some(i => !Number.isInteger(i) || i < 1 || i > imageCount)) {
    throw new Error('Incomplete screenshot extraction');
  }
  const merged: OrderedMessage[] = [];
  for (const screen of [...screenshots].sort((a, b) => a.imageIndex - b.imageIndex)) {
    let overlap = 0;
    for (let count = Math.min(merged.length, screen.messages.length); count > 0; count--) {
      const tail = merged.slice(-count), head = screen.messages.slice(0, count);
      if (!tail.every((message, i) => sameMessage(message, head[i]))) continue;
      // A bare repeated «Ок» is not sufficient evidence of an overlap.
      if (count === 1 && normalized(head[0].content).length < 12) continue;
      overlap = count;
      for (let i = 0; i < count; i++) {
        const index = merged.length - count + i;
        const message = { ...merged[index] };
        if (!message.time && head[i].time) message.time = head[i].time;
        if (!message.senderName && head[i].senderName) message.senderName = head[i].senderName;
        merged[index] = message;
      }
      break;
    }
    merged.push(...screen.messages.slice(overlap));
  }
  return merged;
}
