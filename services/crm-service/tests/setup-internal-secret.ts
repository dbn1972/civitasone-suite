// crm -> notification-service internal auth needs INTERNAL_SERVICE_SECRET. Tests get a fresh
// random value per run (never a committed literal); an explicitly exported value wins.
import { randomUUID } from "node:crypto";

process.env.INTERNAL_SERVICE_SECRET ||= randomUUID();
