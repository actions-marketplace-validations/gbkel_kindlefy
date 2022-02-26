import { SourceConfig } from "@/Protocols/SetupInputProtocol"
import { ParsedRSSItem } from "@/Protocols/ParserProtocol"

export type ContentType = "medium" | "quastor"

export type ContentTypeValidator = (SourceConfig: SourceConfig) => boolean

export type ContentEnricher = (parsedRSSItem: ParsedRSSItem) => Promise<string>
