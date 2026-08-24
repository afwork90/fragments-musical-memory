// The small closed vocabularies the UI shares.
//
// These are *view* types: they describe what a component renders. The on-disk
// equivalents live in `lib/domain/source-document.ts` and are deliberately
// separate — disk and render drift apart (the domain allows "Unclassified" as a
// role, for instance, which the UI translates before display).

export type MusicalRole = "Melody" | "Rhythm" | "Harmony" | "Bass" | "Voice" | "Texture";

export type SearchContext = "whole" | "melody" | "rhythm" | "harmony" | "bass";

export type SourceType = "Voice memo" | "Jam" | "Practice" | "Studio" | "Field recording" | "Archive";

export type RelationshipOrigin = "algorithmic" | "manual" | "auditioned" | "rejected" | "preferred";

export type RelationshipStatus = "suggested" | "auditioned" | "rejected" | "manual" | "preferred";
