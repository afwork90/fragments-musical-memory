export type MusicalRole = "Melody" | "Rhythm" | "Harmony" | "Bass" | "Voice" | "Texture";
export type SearchContext = "whole" | "melody" | "rhythm" | "harmony" | "bass";
export type SourceType = "Voice memo" | "Jam" | "Practice" | "Studio" | "Field recording" | "Archive";
export type RelationshipOrigin = "algorithmic" | "manual" | "auditioned" | "rejected" | "preferred";
export type RelationshipStatus = "suggested" | "auditioned" | "rejected" | "manual" | "preferred";

export interface AnalysisProfile {
  name: string;
  sensitivity: number;
  expectedLength: string;
  detectors: string[];
  tempoStrategy: string;
  keyStrategy: string;
  confidenceThreshold: number;
}

export interface FragmentRef { sourceId:string; start:number; end:number; }
export interface AnalysisMetadata { beats:number; bars:number; confidence:number; userTags:string[]; analysisRevision:number; }

export interface Fragment extends FragmentRef, AnalysisMetadata {
  id: string;
  name: string;
  source: string;
  date: string;
  dateLabel: string;
  duration: string;
  key: string;
  alternateKeys: string[];
  bpm: number;
  role: MusicalRole;
  roles: MusicalRole[];
  brightness: number;
  waveform: number[];
  duplicateGroup?: string;
  audio: string;
  objects?: Partial<Record<SearchContext, string>>;
  sourceTypes: SourceType[];
}

export interface Transform {
  pitch?: number;
  bpm?: number;
  timing?: "half-time" | "double-time";
  beatOffset?: number;
  repeat?: number;
  labels: string[];
  asset: string;
}

export interface Relationship {
  id: string;
  source: string;
  target: string;
  base: number;
  metrics: {
    rhythm: number;
    harmony: number;
    melody: number;
    timbre: number;
    tempo: number;
    pitch: number;
    brightness: number;
  };
  transformationCost: number;
  reason: string;
  transform?: Transform;
  experimental?: boolean;
  origin?: RelationshipOrigin;
  status?: RelationshipStatus;
}

export interface SearchWeights {
  rhythm: number;
  harmony: number;
  melody: number;
  timbre: number;
}

export interface MatchTolerances {
  tempoWindow: number;
  keyFlexibility: "exact" | "related" | "nearby";
  lengthTolerance: "same" | "one" | "any";
  allowRepetition: boolean;
}

export interface SourceFile {
  id: string;
  name: string;
  date: string;
  duration: number;
  format: string;
  device: string;
  fragmentIds: string[];
  waveform: number[];
  sensitivity: number;
  start: number;
  end: number;
  sourceTypes: SourceType[];
  analysisProfile: AnalysisProfile;
  imported?: boolean;
}

export interface ImportSession { sourceId:string; tags:SourceType[]; stage:"classify" | "Importing" | "Segmenting" | "Extracting metadata" | "Matching" | "Ready"; }
export interface CombineSession { anchorId:string; candidateIds:string[]; activeCandidateId:string; returnScroll:number; }

const wave = (seed: number, count = 28) => Array.from({ length: count }, (_, index) => 22 + ((seed * 17 + index * 31 + index * index * 7) % 74));

const heroObjects = (id: "f01" | "f02") => ({
  whole: `/audio/${id}.wav`,
  melody: `/audio/${id}_melody.wav`,
  rhythm: `/audio/${id}_rhythm.wav`,
  harmony: `/audio/${id}_harmony.wav`,
  bass: `/audio/${id}_bass.wav`,
});

const rawFragments: Omit<Fragment, "waveform" | "audio" | "sourceId" | "start" | "end" | "beats" | "bars" | "confidence" | "userTags" | "analysisRevision" | "sourceTypes">[] = [
  { id:"f01", name:"Balcony guitar, 1:14am", source:"Balcony ideas — Aug 20.m4a", date:"2026-08-20", dateLabel:"Aug 20, 2026", duration:"0:18", key:"A minor", alternateKeys:["C major"], bpm:92, role:"Harmony", roles:["Harmony","Rhythm"], brightness:46, duplicateGroup:"balcony", objects:heroObjects("f01") },
  { id:"f02", name:"Kitchen hum / winter", source:"Voice Memo 184.m4a", date:"2018-01-06", dateLabel:"Jan 06, 2018", duration:"0:13", key:"Likely C minor", alternateKeys:["E♭ major","A minor after −3 st"], bpm:88, role:"Melody", roles:["Melody","Voice"], brightness:57, objects:heroObjects("f02") },
  { id:"f03", name:"Loose pocket idea", source:"Practice room spill.wav", date:"2021-10-23", dateLabel:"Oct 23, 2021", duration:"0:09", key:"No stable key", alternateKeys:[], bpm:94, role:"Rhythm", roles:["Rhythm"], brightness:64 },
  { id:"f04", name:"Glass piano changes", source:"Piano sketches 03.wav", date:"2024-03-11", dateLabel:"Mar 11, 2024", duration:"0:22", key:"A minor", alternateKeys:["C major"], bpm:90, role:"Harmony", roles:["Harmony","Melody"], brightness:72 },
  { id:"f05", name:"Half-time floor tom", source:"Drum room leftovers.wav", date:"2019-09-02", dateLabel:"Sep 02, 2019", duration:"0:11", key:"—", alternateKeys:[], bpm:46, role:"Rhythm", roles:["Rhythm"], brightness:38 },
  { id:"f06", name:"Cassette bass figure", source:"Tascam side B.aif", date:"2017-05-17", dateLabel:"May 17, 2017", duration:"0:16", key:"A minor", alternateKeys:["A Dorian"], bpm:92, role:"Bass", roles:["Bass","Rhythm"], brightness:29 },
  { id:"f07", name:"Balcony guitar — take 2", source:"Balcony ideas — Aug 20.m4a", date:"2026-08-20", dateLabel:"Aug 20, 2026", duration:"0:20", key:"A minor", alternateKeys:["C major"], bpm:91, role:"Harmony", roles:["Harmony"], brightness:44, duplicateGroup:"balcony" },
  { id:"f08", name:"Balcony guitar / phone pocket", source:"Balcony ideas — Aug 20.m4a", date:"2026-08-20", dateLabel:"Aug 20, 2026", duration:"0:17", key:"A minor", alternateKeys:[], bpm:93, role:"Harmony", roles:["Harmony","Texture"], brightness:32, duplicateGroup:"balcony" },
  { id:"f09", name:"Balcony guitar — clean pass", source:"Balcony clean.wav", date:"2026-08-19", dateLabel:"Aug 19, 2026", duration:"0:19", key:"A minor", alternateKeys:["C major"], bpm:92, role:"Harmony", roles:["Harmony"], brightness:61, duplicateGroup:"balcony" },
  { id:"f10", name:"Balcony guitar ending", source:"Balcony ideas — Aug 20.m4a", date:"2026-08-20", dateLabel:"Aug 20, 2026", duration:"0:08", key:"A minor", alternateKeys:[], bpm:92, role:"Melody", roles:["Melody","Harmony"], brightness:49, duplicateGroup:"balcony" },
  { id:"f11", name:"Stairwell harmony", source:"Voice Memo 311.m4a", date:"2020-02-14", dateLabel:"Feb 14, 2020", duration:"0:12", key:"Likely E minor", alternateKeys:["G major"], bpm:84, role:"Voice", roles:["Voice","Harmony"], brightness:53 },
  { id:"f12", name:"Rain on practice amp", source:"Rain session.wav", date:"2022-11-05", dateLabel:"Nov 05, 2022", duration:"0:27", key:"D minor", alternateKeys:[], bpm:76, role:"Texture", roles:["Texture","Harmony"], brightness:22 },
  { id:"f13", name:"Sunday organ loop", source:"Organ sketches.wav", date:"2019-04-21", dateLabel:"Apr 21, 2019", duration:"0:24", key:"G major", alternateKeys:["E minor"], bpm:82, role:"Harmony", roles:["Harmony","Melody"], brightness:67 },
  { id:"f14", name:"Whistled hook at Queen St", source:"Street memo 07.m4a", date:"2017-08-09", dateLabel:"Aug 09, 2017", duration:"0:10", key:"Likely F major", alternateKeys:["D minor","C Mixolydian"], bpm:101, role:"Melody", roles:["Melody","Voice"], brightness:81 },
  { id:"f15", name:"Pedal-noise rhythm", source:"Board noise.aif", date:"2025-06-30", dateLabel:"Jun 30, 2025", duration:"0:07", key:"—", alternateKeys:[], bpm:96, role:"Rhythm", roles:["Rhythm","Texture"], brightness:74 },
  { id:"f16", name:"Broken-string waltz", source:"Acoustic repairs.m4a", date:"2018-06-03", dateLabel:"Jun 03, 2018", duration:"0:21", key:"D major", alternateKeys:["B minor"], bpm:72, role:"Harmony", roles:["Harmony","Rhythm"], brightness:58, duplicateGroup:"acoustic-repairs" },
  { id:"f17", name:"Metro drum tapping", source:"Subway ideas.m4a", date:"2023-01-18", dateLabel:"Jan 18, 2023", duration:"0:08", key:"—", alternateKeys:[], bpm:108, role:"Rhythm", roles:["Rhythm"], brightness:69 },
  { id:"f18", name:"Soft-synth bridge", source:"Juno fragments.wav", date:"2020-12-29", dateLabel:"Dec 29, 2020", duration:"0:18", key:"A minor", alternateKeys:["C major"], bpm:184, role:"Harmony", roles:["Harmony","Texture"], brightness:63, duplicateGroup:"juno-session" },
  { id:"f19", name:"Chorus without words", source:"Voice Memo 402.m4a", date:"2022-07-07", dateLabel:"Jul 07, 2022", duration:"0:14", key:"B minor", alternateKeys:["D major"], bpm:88, role:"Voice", roles:["Voice","Melody"], brightness:55 },
  { id:"f20", name:"7am bass line", source:"Morning bass.wav", date:"2025-02-02", dateLabel:"Feb 02, 2025", duration:"0:15", key:"A minor", alternateKeys:["A Dorian"], bpm:90, role:"Bass", roles:["Bass","Rhythm"], brightness:35 },
  { id:"f21", name:"Rehearsal-room spill", source:"Full rehearsal 2018.wav", date:"2018-10-12", dateLabel:"Oct 12, 2018", duration:"0:31", key:"G major", alternateKeys:["E minor"], bpm:80, role:"Texture", roles:["Texture","Harmony"], brightness:41 },
  { id:"f22", name:"Voice note — two notes", source:"Voice Memo 184.m4a", date:"2026-01-12", dateLabel:"Jan 12, 2026", duration:"0:06", key:"Could fit several keys", alternateKeys:["G major","E minor","C major"], bpm:78, role:"Melody", roles:["Melody","Voice"], brightness:62 },
  { id:"f23", name:"Tape-hiss chords", source:"Tascam side B.aif", date:"2017-05-17", dateLabel:"May 17, 2017", duration:"0:19", key:"C minor", alternateKeys:["E♭ major"], bpm:88, role:"Harmony", roles:["Harmony","Texture"], brightness:27 },
  { id:"f24", name:"Handclap pocket", source:"Kitchen percussion.m4a", date:"2024-09-19", dateLabel:"Sep 19, 2024", duration:"0:08", key:"—", alternateKeys:[], bpm:92, role:"Rhythm", roles:["Rhythm"], brightness:78 },
  { id:"f25", name:"Open-tuning sketch", source:"Acoustic repairs.m4a", date:"2018-06-03", dateLabel:"Jun 03, 2018", duration:"0:25", key:"D major", alternateKeys:["G major"], bpm:86, role:"Harmony", roles:["Harmony","Melody"], brightness:66, duplicateGroup:"acoustic-repairs" },
  { id:"f26", name:"Neon arpeggio", source:"Juno fragments.wav", date:"2020-12-29", dateLabel:"Dec 29, 2020", duration:"0:12", key:"F♯ minor", alternateKeys:["A major"], bpm:116, role:"Melody", roles:["Melody","Harmony"], brightness:86, duplicateGroup:"juno-session" },
  { id:"f27", name:"Last-train melody", source:"Subway ideas.m4a", date:"2023-01-18", dateLabel:"Jan 18, 2023", duration:"0:11", key:"Likely E minor", alternateKeys:["G major"], bpm:94, role:"Melody", roles:["Melody"], brightness:59 },
  { id:"f28", name:"Window-fan drone", source:"Room tone archive.wav", date:"2019-07-28", dateLabel:"Jul 28, 2019", duration:"0:33", key:"A?", alternateKeys:["No stable key"], bpm:64, role:"Texture", roles:["Texture"], brightness:19 },
];

const IMPORT_SOURCE_NAME = "Balcony ideas — Aug 20.m4a";
export const STAGED_SOURCE_ID = "source-balcony-aug20";
export const IMPORTED_FRAGMENT_IDS = ["f01","f07","f08","f10"];
const uniqueSourceNames = Array.from(new Set(rawFragments.map((fragment) => fragment.source)));
const sourceIdByName = new Map(uniqueSourceNames.map((name,index) => [name,name === IMPORT_SOURCE_NAME ? STAGED_SOURCE_ID : `source-${String(index + 1).padStart(2,"0")}`]));
const stagedRanges:Record<string,[number,number]> = { f01:[74,92],f07:[108,128],f08:[151,168],f10:[207,215],f22:[34,40] };
const sourceTypesFor = (name:string):SourceType[] => name === IMPORT_SOURCE_NAME ? ["Voice memo","Jam"] : name.includes("Voice Memo") ? ["Voice memo"] : name.includes("Street") || name.includes("Subway") || name.includes("Room tone") ? ["Field recording"] : name.includes("Practice") || name.includes("rehearsal") ? ["Practice","Jam"] : name.includes("Tascam") ? ["Archive"] : ["Studio"];
const formatDuration = (seconds:number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2,"0")}`;

export const FRAGMENTS: Fragment[] = rawFragments.map((fragment, index) => {
  const seconds = fragment.duration.split(":").map(Number).reduce((minutes,value) => minutes * 60 + value);
  const [start,end] = stagedRanges[fragment.id] ?? [10 + (index * 17) % 74,10 + (index * 17) % 74 + seconds];
  const measuredBeats:Record<string,number> = { f01:18,f02:19,f04:16,f06:16,f07:19,f08:17,f10:8 };
  const beats = measuredBeats[fragment.id] ?? Math.max(4,Math.round(seconds * fragment.bpm / 60));
  return {
    ...fragment, sourceId:sourceIdByName.get(fragment.source)!, start, end, duration:formatDuration(end - start),
    beats, bars:["f01","f02","f04","f06"].includes(fragment.id) ? 4 : Math.max(1,Math.round(beats / 4)), confidence:fragment.id === "f01" ? .91 : .72 + ((index * 7) % 24) / 100,
    userTags:fragment.id === "f01" ? ["late night","guitar"] : [fragment.role.toLowerCase()], analysisRevision:1,
    sourceTypes:sourceTypesFor(fragment.source), waveform:wave(index + 3), audio:`/audio/f${String(index + 1).padStart(2,"0")}.wav`,
  };
});

const rel = (id:string, source:string, target:string, base:number, metrics:Relationship["metrics"], transformationCost:number, reason:string, transform?:Transform, experimental=false):Relationship => ({ id, source, target, base, metrics, transformationCost, reason, transform, experimental });

export const RELATIONSHIPS: Relationship[] = [
  rel("r01","f01","f02",.94,{rhythm:.82,harmony:.97,melody:.95,timbre:.68,tempo:.89,pitch:.99,brightness:.76},.025,"Melody contour and harmonic movement align after a small pitch shift.",{pitch:-3,bpm:4,labels:["−3 st","+4 BPM"],asset:"/audio/f02_match.wav"}),
  rel("r02","f01","f03",.78,{rhythm:.99,harmony:.38,melody:.31,timbre:.84,tempo:.97,pitch:.50,brightness:.75},.045,"The pocket locks when its first accent moves to beat two.",{beatOffset:1,labels:["+1 beat"],asset:"/audio/f03_beat2.wav"}),
  rel("r03","f01","f04",.85,{rhythm:.73,harmony:.94,melody:.69,timbre:.76,tempo:.96,pitch:.98,brightness:.72},.01,"The piano voicing leaves exactly the same harmonic space.",{bpm:2,labels:["+2 BPM"],asset:"/audio/f04.wav"}),
  rel("r04","f01","f06",.80,{rhythm:.86,harmony:.88,melody:.58,timbre:.74,tempo:.99,pitch:.97,brightness:.64},.02,"A grounded bass answer follows the guitar's descending shape.",{labels:["As recorded"],asset:"/audio/f06.wav"}),
  rel("r05","f01","f05",.84,{rhythm:.96,harmony:.47,melody:.36,timbre:.88,tempo:.91,pitch:.52,brightness:.59},.16,"At half-time, the floor tom turns the sketch into a slow, heavy chorus.",{timing:"half-time",labels:["½ time"],asset:"/audio/f05_halftime.wav"},true),
  rel("r06","f01","f14",.88,{rhythm:.68,harmony:.83,melody:.96,timbre:.51,tempo:.77,pitch:.92,brightness:.80},.24,"A wide pitch move reveals the same three-note question and answer.",{pitch:4,bpm:-9,labels:["+4 st","−9 BPM"],asset:"/audio/f14_pitch.wav"},true),
  rel("r07","f01","f18",.82,{rhythm:.91,harmony:.90,melody:.66,timbre:.83,tempo:.94,pitch:.97,brightness:.74},.21,"Double-time arpeggios create a restless bridge above the guitar.",{timing:"double-time",labels:["2× time"],asset:"/audio/f18_double.wav"},true),
  rel("r08","f02","f19",.89,{rhythm:.74,harmony:.84,melody:.96,timbre:.92,tempo:.99,pitch:.81,brightness:.90},.03,"Two unfinished vocal shapes complete one another.",{pitch:-2,labels:["−2 st"],asset:"/audio/f19.wav"}),
  rel("r09","f02","f22",.79,{rhythm:.62,harmony:.72,melody:.93,timbre:.88,tempo:.85,pitch:.74,brightness:.87},.01,"Ambiguous notes create several plausible melodic continuations.",{labels:["Alternate key lens"],asset:"/audio/f22.wav"}),
  rel("r10","f03","f24",.93,{rhythm:.98,harmony:.40,melody:.28,timbre:.91,tempo:.98,pitch:.50,brightness:.88},.0,"Both gestures share the same loose sixteenth-note pocket.",{labels:["As recorded"],asset:"/audio/f24.wav"}),
  rel("r11","f04","f13",.86,{rhythm:.72,harmony:.95,melody:.78,timbre:.89,tempo:.87,pitch:.82,brightness:.81},.04,"The organ extends the same suspended chord motion.",{pitch:2,labels:["+2 st"],asset:"/audio/f13.wav"}),
  rel("r12","f06","f20",.91,{rhythm:.94,harmony:.89,melody:.66,timbre:.95,tempo:.97,pitch:.99,brightness:.91},.01,"Two bass figures share a patient off-beat resolution.",{bpm:2,labels:["+2 BPM"],asset:"/audio/f20.wav"}),
  rel("r13","f11","f19",.88,{rhythm:.77,harmony:.90,melody:.91,timbre:.96,tempo:.92,pitch:.86,brightness:.93},.04,"The stairwell harmony sits naturally beneath the wordless chorus.",{pitch:-1,labels:["−1 st"],asset:"/audio/f19.wav"}),
  rel("r14","f12","f28",.90,{rhythm:.58,harmony:.76,melody:.42,timbre:.99,tempo:.71,pitch:.63,brightness:.95},.0,"Room noise and amplifier rain form one continuous atmosphere.",{labels:["As recorded"],asset:"/audio/f28.wav"}),
  rel("r15","f14","f27",.87,{rhythm:.82,harmony:.84,melody:.97,timbre:.73,tempo:.93,pitch:.88,brightness:.76},.06,"The train melody answers the whistle with the same rising interval.",{beatOffset:2,labels:["+2 beats"],asset:"/audio/f27.wav"}),
  rel("r16","f15","f17",.85,{rhythm:.96,harmony:.38,melody:.22,timbre:.88,tempo:.84,pitch:.50,brightness:.92},.05,"Mechanical clicks become a complementary percussion layer.",{bpm:-12,labels:["−12 BPM"],asset:"/audio/f17.wav"}),
  rel("r17","f16","f25",.92,{rhythm:.89,harmony:.98,melody:.91,timbre:.97,tempo:.91,pitch:.99,brightness:.94},.0,"These are different ideas from the same open-tuning session.",{labels:["As recorded"],asset:"/audio/f25.wav"}),
  rel("r18","f18","f26",.86,{rhythm:.92,harmony:.91,melody:.88,timbre:.96,tempo:.83,pitch:.79,brightness:.93},.09,"The arpeggio turns the bridge into a brighter alternate section.",{pitch:3,labels:["+3 st"],asset:"/audio/f26.wav"}),
  rel("r19","f21","f23",.83,{rhythm:.69,harmony:.91,melody:.57,timbre:.97,tempo:.88,pitch:.85,brightness:.89},.04,"Tape bleed preserves the rehearsal's chord color.",{bpm:8,labels:["+8 BPM"],asset:"/audio/f23.wav"}),
  rel("r20","f22","f13",.78,{rhythm:.59,harmony:.88,melody:.90,timbre:.63,tempo:.84,pitch:.71,brightness:.72},.02,"One alternate key interpretation places the two-note idea inside the organ loop.",{labels:["G major lens"],asset:"/audio/f13.wav"}),
];

const DEFAULT_PROFILE:AnalysisProfile = { name:"General musical sketch",sensitivity:52,expectedLength:"8–28 sec",detectors:["Silence","Transient","Spectral change"],tempoStrategy:"Flexible pulse",keyStrategy:"Primary + alternate interpretations",confidenceThreshold:.68 };
export const MESSY_PHONE_PROFILE:AnalysisProfile = { name:"Messy phone jam",sensitivity:68,expectedLength:"6–24 sec",detectors:["Transient","Silence","Spectral change"],tempoStrategy:"Adaptive, allow drift",keyStrategy:"Primary + relative-key alternatives",confidenceThreshold:.62 };

export const SOURCE_FILES: SourceFile[] = uniqueSourceNames.map((name,index) => {
  const fragments=FRAGMENTS.filter((fragment) => fragment.source === name);
  const imported=name === IMPORT_SOURCE_NAME;
  const maxEnd=Math.max(...fragments.map((fragment) => fragment.end));
  const duration=imported ? 522 : Math.max(93,maxEnd + 38 + (index % 4) * 31);
  return {
    id:sourceIdByName.get(name)!, name, date:imported ? "Aug 20, 2026" : fragments[0].dateLabel, duration,
    format:name.toLowerCase().endsWith(".m4a") ? "M4A · 11.4 MB" : name.toLowerCase().endsWith(".aif") ? "AIFF · 38.7 MB" : "WAV · 24.1 MB",
    device:imported || name.includes("Voice") ? "iPhone microphone" : name.includes("Tascam") ? "Tascam DR-05" : "Room recorder",
    fragmentIds:fragments.map((fragment) => fragment.id),waveform:wave(31 + index * 7,144),sensitivity:imported ? 68 : 38 + (index * 9) % 34,
    start:Math.min(...fragments.map((fragment) => fragment.start)),end:Math.max(...fragments.map((fragment) => fragment.end)),
    sourceTypes:sourceTypesFor(name),analysisProfile:imported ? MESSY_PHONE_PROFILE : { ...DEFAULT_PROFILE },imported,
  };
});

export const DEFAULT_WEIGHTS: SearchWeights = { rhythm:54, harmony:72, melody:68, timbre:36 };
export const DEFAULT_TOLERANCES:MatchTolerances = { tempoWindow:10,keyFlexibility:"related",lengthTolerance:"one",allowRepetition:true };
