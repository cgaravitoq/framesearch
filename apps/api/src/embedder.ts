import { Container } from "@cloudflare/containers";
import type { Env } from "./env.ts";

export class EmbedderContainer extends Container<Env> {
  override defaultPort = 8080;
  override sleepAfter = "5m";
  override enableInternet = false;
  override pingEndpoint = "health";
}
