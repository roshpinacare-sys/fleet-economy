// Dynamic Load Balancing Algorithm for Fleet Economy
// Handles heavy load bottlenecks and high memory usage

// 1. Dynamic Bottleneck Request Type Identification
interface BottleneckProfile {
  requestType: string;
  detectionHeuristic: (req: any) => boolean;
  threshold: number;
  cooldown: number;
}

const bottleneckProfiles: BottleneckProfile[] = [
  {
    requestType: 'high_frequency_trade',
    detectionHeuristic: (req) => req.frequency && req.frequency > 100,
    threshold: 50,
    cooldown: 30000,
  },
  {
    requestType: 'large_batch_processing',
    detectionHeuristic: (req) => req.size && req.size > 1000,
    threshold: 200,
    cooldown: 60000,
  },
];

function detectBottleneck(req: any): BottleneckProfile | null {
  for (const profile of bottleneckProfiles) {
    if (profile.detectionHeuristic(req)) {
      return profile;
    }
  }
  return null;
}

// 2. Preferred Processing Strategy
enum ProcessingStrategy {
  STANDARD = 'standard',
  BATCHED = 'batched',
  PRIORITY_QUEUE = 'priority',
  DEFERRED = 'deferred',
}

interface StrategyConfig {
  strategy: ProcessingStrategy;
  resourcePool: string;
  maxConcurrent: number;
  timeoutMs: number;
}

function selectStrategy(profile: BottleneckProfile, currentLoad: number): StrategyConfig {
  if (currentLoad > profile.threshold) {
    return {
      strategy: ProcessingStrategy.BATCHED,
      resourcePool: `${profile.requestType}-pool`,
      maxConcurrent: Math.max(1, Math.floor(100 / currentLoad * 10)),
      timeoutMs: profile.cooldown,
    };
  }
  return {
    strategy: ProcessingStrategy.STANDARD,
    resourcePool: 'default',
    maxConcurrent: 50,
    timeoutMs: 5000,
  };
}

// 3. Real-time Waiting Time Monitoring & Emergency Mode
class WaitingTimeMonitor {
  private readonly SAMPLE_WINDOW = 1000;
  private waitTimes: number[] = [];
  private emergencyThreshold = 5000;
  private emergencyMode = false;
  private emergencySince = 0;

  recordWaitTime(waitMs: number) {
    this.waitTimes.push(waitMs);
    if (this.waitTimes.length > this.SAMPLE_WINDOW) {
      this.waitTimes.shift();
    }
  }

  getAverageWait(): number {
    if (this.waitTimes.length === 0) return 0;
    const sum = this.waitTimes.reduce((a, b) => a + b, 0);
    return sum / this.waitTimes.length;
  }

  checkEmergency(): boolean {
    const avg = this.getAverageWait();
    if (avg > this.emergencyThreshold && !this.emergencyMode) {
      this.emergencyMode = true;
      this.emergencySince = Date.now();
      console.log('[EMERGENCY] Waiting time threshold exceeded:', avg, 'ms');
      return true;
    }
    if (avg <= this.emergencyThreshold / 2 && this.emergencyMode) {
      this.emergencyMode = false;
      console.log('[RECOVERY] Waiting time normalized:', avg, 'ms');
    }
    return this.emergencyMode;
  }

  isEmergencyActive(): boolean {
    return this.emergencyMode && (Date.now() - this.emergencySince) < 300000; // 5 min max
  }
}

const waitMonitor = new WaitingTimeMonitor();

// 4. Flexible Priority Rating
interface PriorityRating {
  requestId: string;
  basePriority: number;
  waitPenalty: number;
  urgencyMultiplier: number;
  finalScore: number;
}

function calculatePriority(req: any, waitTime: number): PriorityRating {
  const basePriority = req.priority ?? 5;
  const urgencyMultiplier = req.urgency ?? 1;
  // Wait time penalty increases non-linearly after 2s
  const waitPenalty = Math.min(waitTime * 0.1, 50);
  
  const finalScore = basePriority * urgencyMultiplier - waitPenalty;
  
  return {
    requestId: req.id || 'unknown',
    basePriority,
    waitPenalty,
    urgencyMultiplier,
    finalScore,
  };
}

// 5. API for Bottleneck Predictions
interface BottleneckPrediction {
  requestType: string;
  predictedLoad: number;
  estimatedWait: number;
  recommendedAction: string;
  timestamp: number;
}

function predictBottleneck(): BottleneckPrediction {
  const avgWait = waitMonitor.getAverageWait();
  const isEmergency = waitMonitor.checkEmergency();
  
  let predictedLoad = 0;
  let recommendedAction = 'monitor';
  
  if (isEmergency) {
    predictedLoad = 95;
    recommendedAction = 'switch_to_priority_queue';
  } else if (avgWait > 2000) {
    predictedLoad = 70;
    recommendedAction = 'enable_batching';
  } else {
    predictedLoad = 30;
    recommendedAction = 'standard_processing';
  }
  
  return {
    requestType: 'mixed',
    predictedLoad,
    estimatedWait: Math.round(avgWait),
    recommendedAction,
    timestamp: Date.now(),
  };
}

export { 
  bottleneckProfiles,
  detectBottleneck,
  selectStrategy,
  waitMonitor,
  calculatePriority,
  predictBottleneck,
  ProcessingStrategy,
  PriorityRating,
};

// Example usage:
// const profile = detectBottleneck(incomingRequest);
// if (profile) {
//   const config = selectStrategy(profile, currentSystemLoad);
//   const priority = calculatePriority(incomingRequest, waitMonitor.getAverageWait());
//   const prediction = predictBottleneck();
// }"