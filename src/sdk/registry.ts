// /src/sdk/registry.ts
// Single source of truth for every archetype the planner may assign.
// Every scene is a motion-graphics composition designed in a 1920x1080 comp.

import type { ComponentType } from "react";
import type { ArchetypeName, SceneProps } from "./contract";
import { KineticHero, ScaleTradeoff, SplitComparison, DeviceMockup, DarkImpactClose } from "../mg/scenes/editorial";
import { ChartStory, BarComparison, PerspectiveDataGrid, BentoBadgeCluster } from "../mg/scenes/data";
import { NetworkMesh, RadialHub, InvestigationBoard, MagnifierInspect, QueryTrace } from "../mg/scenes/case";

export const ARCHETYPE_REGISTRY: Record<ArchetypeName, ComponentType<SceneProps>> = {
  KineticHero,
  SplitComparison,
  PerspectiveDataGrid,
  RadialHub,
  DeviceMockup,
  BentoBadgeCluster,
  ScaleTradeoff,
  DarkImpactClose,
  ChartStory,
  BarComparison,
  NetworkMesh,
  InvestigationBoard,
  MagnifierInspect,
  QueryTrace,
};

export const ALL_ARCHETYPES = Object.keys(ARCHETYPE_REGISTRY) as ArchetypeName[];
