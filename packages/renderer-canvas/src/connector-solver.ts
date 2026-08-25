import type {
  ApprovedTransform,
  ConnectorProfile,
  Point2D,
  TransitionBridgeDefinition,
} from '@qmonster/generator-core'
import type { Placement } from './types.js'

export interface SolvedConnector {
  ok: true
  connectorId: string
  bridgeId: string
  childPlacement: Placement
  receiverOrigin: Point2D
  plugOrigin: Point2D
  receiverTangent: Point2D
  plugTangent: Point2D
  receiverNormal: Point2D
  plugNormal: Point2D
  receiverWidth: number
  plugWidth: number
  receiverDepth: number
  plugDepth: number
  widthRatio: number
  depthRatio: number
  rotationDegrees: number
}

export interface ConnectorSolveFailure {
  ok: false
  code: 'CONNECTOR_PROFILE_INVALID' | 'CONNECTOR_WARP_EXCEEDED' | 'CONNECTOR_BRIDGE_MISSING'
  message: string
}

export type ConnectorSolveResult = SolvedConnector | ConnectorSolveFailure

function finitePoint(point: Point2D): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function validProfile(profile: ConnectorProfile): boolean {
  return finitePoint(profile.origin)
    && finitePoint(profile.tangent)
    && finitePoint(profile.outwardNormal)
    && finitePositive(profile.width)
    && finitePositive(profile.depth)
    && Math.hypot(profile.tangent.x, profile.tangent.y) > 0
    && Math.hypot(profile.outwardNormal.x, profile.outwardNormal.y) > 0
}

function within(value: number, range: { min: number; max: number }): boolean {
  return Number.isFinite(value)
    && value >= range.min
    && value <= range.max
}

function unit(point: Point2D): Point2D {
  const length = Math.hypot(point.x, point.y)
  return { x: point.x / length, y: point.y / length }
}

function angleDegrees(receiver: ConnectorProfile, plugTangent: Point2D): number {
  const left = unit(receiver.tangent)
  const right = unit(plugTangent)
  return Math.atan2(
    left.x * right.y - left.y * right.x,
    left.x * right.x + left.y * right.y,
  ) * 180 / Math.PI
}

export function solveConnector(
  receiver: ConnectorProfile,
  plug: ConnectorProfile,
  bridge: TransitionBridgeDefinition | undefined,
  transform: ApprovedTransform = { scale: 1, mirrorX: false },
): ConnectorSolveResult {
  if (
    receiver.role !== 'receiver'
    || plug.role !== 'plug'
    || receiver.id !== plug.id
    || receiver.rigId !== plug.rigId
    || receiver.connectorClass !== plug.connectorClass
    || !validProfile(receiver)
    || !validProfile(plug)
  ) {
    return {
      ok: false,
      code: 'CONNECTOR_PROFILE_INVALID',
      message: `Connector ${receiver.id} requires one finite complementary receiver/plug pair.`,
    }
  }
  if (
    bridge === undefined
    || bridge.rigId !== receiver.rigId
    || bridge.connectorClass !== receiver.connectorClass
  ) {
    return {
      ok: false,
      code: 'CONNECTOR_BRIDGE_MISSING',
      message: `Connector ${receiver.id} requires an exact ${receiver.rigId} ${receiver.connectorClass} bridge.`,
    }
  }

  const scaleX = transform.mirrorX ? -transform.scale : transform.scale
  const scaleY = transform.scale
  const transformedPlugOrigin = {
    x: plug.origin.x * scaleX,
    y: plug.origin.y * scaleY,
  }
  const transformedPlugTangent = unit({
    x: plug.tangent.x * scaleX,
    y: plug.tangent.y * scaleY,
  })
  const transformedPlugNormal = unit({
    x: plug.outwardNormal.x * scaleX,
    y: plug.outwardNormal.y * scaleY,
  })
  const widthRatio = plug.width * Math.abs(scaleX) / receiver.width
  const depthRatio = plug.depth * Math.abs(scaleY) / receiver.depth
  const rotationDegrees = angleDegrees(receiver, transformedPlugTangent)
  if (
    !within(widthRatio, receiver.warpLimits.widthRatio)
    || !within(widthRatio, plug.warpLimits.widthRatio)
    || !within(depthRatio, receiver.warpLimits.depthRatio)
    || !within(depthRatio, plug.warpLimits.depthRatio)
    || !within(rotationDegrees, receiver.warpLimits.rotationDegrees)
    || !within(rotationDegrees, plug.warpLimits.rotationDegrees)
  ) {
    return {
      ok: false,
      code: 'CONNECTOR_WARP_EXCEEDED',
      message: `Connector ${receiver.id} exceeds declared width, depth, or rotation warp limits.`,
    }
  }

  const childPlacement: Placement = {
    x: receiver.origin.x,
    y: receiver.origin.y,
    scaleX,
    scaleY,
    ...(rotationDegrees === 0 ? {} : { rotationDegrees: -rotationDegrees }),
  }
  const childRadians = -rotationDegrees * Math.PI / 180
  const rotatedPlugOrigin = {
    x: transformedPlugOrigin.x * Math.cos(childRadians) - transformedPlugOrigin.y * Math.sin(childRadians),
    y: transformedPlugOrigin.x * Math.sin(childRadians) + transformedPlugOrigin.y * Math.cos(childRadians),
  }
  childPlacement.x -= rotatedPlugOrigin.x
  childPlacement.y -= rotatedPlugOrigin.y
  const receiverNormal = unit(receiver.outwardNormal)
  const receiverTangent = unit(receiver.tangent)
  const plugTangent = {
    x: transformedPlugTangent.x * Math.cos(childRadians) - transformedPlugTangent.y * Math.sin(childRadians),
    y: transformedPlugTangent.x * Math.sin(childRadians) + transformedPlugTangent.y * Math.cos(childRadians),
  }
  const plugNormal = {
    x: transformedPlugNormal.x * Math.cos(childRadians) - transformedPlugNormal.y * Math.sin(childRadians),
    y: transformedPlugNormal.x * Math.sin(childRadians) + transformedPlugNormal.y * Math.cos(childRadians),
  }
  const receiverOrigin = {
    x: receiver.origin.x - receiverNormal.x * receiver.depth / 2,
    y: receiver.origin.y - receiverNormal.y * receiver.depth / 2,
  }
  const plugOrigin = {
    x: receiver.origin.x - plugNormal.x * plug.depth * Math.abs(scaleY) / 2,
    y: receiver.origin.y - plugNormal.y * plug.depth * Math.abs(scaleY) / 2,
  }
  return {
    ok: true,
    connectorId: receiver.id,
    bridgeId: bridge.id,
    childPlacement,
    receiverOrigin,
    plugOrigin,
    receiverTangent,
    plugTangent,
    receiverNormal,
    plugNormal,
    receiverWidth: receiver.width,
    plugWidth: plug.width * Math.abs(scaleX),
    receiverDepth: receiver.depth,
    plugDepth: plug.depth * Math.abs(scaleY),
    widthRatio,
    depthRatio,
    rotationDegrees,
  }
}
