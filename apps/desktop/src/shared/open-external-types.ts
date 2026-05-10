export type OpenExternalFailureReason = 'empty' | 'invalid' | 'unsupported-protocol' | 'open-failed';

export interface OpenExternalFailurePayload {
  reason: OpenExternalFailureReason;
  url: string;
}
