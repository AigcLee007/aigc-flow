import type { Redis } from "ioredis";

export class RedisPubSub {
  constructor(
    private readonly publisher: Redis,
    private readonly subscriber: Redis,
  ) {}

  async publish(channel: string, payload: string): Promise<number> {
    return this.publisher.publish(channel, payload);
  }

  async subscribe(
    channel: string,
    handler: (payload: string, channelName: string) => void,
  ): Promise<void> {
    this.subscriber.on("message", (channelName, payload) => {
      if (channelName === channel) {
        handler(payload, channelName);
      }
    });

    await this.subscriber.subscribe(channel);
  }

  async close(): Promise<void> {
    await this.subscriber.unsubscribe();
  }
}
