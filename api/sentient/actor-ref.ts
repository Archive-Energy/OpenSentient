import type { CalibrationState, DatasetConfig, IngestSignal } from "../../actor/types"

export interface ActorHandle {
	getStatus: () => Promise<Record<string, unknown>>
	getCalibrationState: () => Promise<CalibrationState>
	receiveSignal: (signal: IngestSignal) => Promise<void>
	runNow: (reason?: string) => Promise<void>
	correctPosition: (slug: string, text: string, confidence: number) => Promise<void>
	confirmTension: (slug: string) => Promise<void>
	dismissTension: (slug: string) => Promise<void>
	acceptProof: (slug: string, confidence?: number) => Promise<void>
	rejectProof: (slug: string, note: string) => Promise<void>
	adjustThreshold: (value: number) => Promise<void>
	adjustSignalWeight: (source: string, weight: number) => Promise<void>
	ingestDataset: (config: DatasetConfig) => Promise<void>
}

let actorRef: ActorHandle | null = null

export function setActorRef(ref: ActorHandle) {
	actorRef = ref
}

export function getActorRef(): ActorHandle | null {
	return actorRef
}
