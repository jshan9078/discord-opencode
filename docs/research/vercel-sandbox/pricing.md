# Pricing and Limits

## Pricing

| | Hobby (Free) | Pro | Enterprise |
|---|---:|---:|---:|
| Sandbox Active CPU | 5 hours/mo | $0.128/hour | $0.128/hour |
| Sandbox Provisioned Memory | 420 GB-hours/mo | $0.0212/GB-hour | $0.0212/GB-hour |
| Sandbox Creations | 5,000/mo | $0.60/1M | $0.60/1M |
| Sandbox Data Transfer | 20 GB/mo | $0.15/GB | $0.15/GB |
| Snapshot Storage | 15 GB (lifetime) | $0.08/GB-month | $0.08/GB-month |
| Concurrent Sandboxes | 10 | 2,000 | 2,000 |
| Max Runtime | 45 min | 5 hours | 5 hours |
| vCPU Allocation | 40/10 min | 200/min | 400/min |

## Understanding Metrics

- **Active CPU**: Time code actively uses CPU (I/O wait not billed)
- **Provisioned Memory**: GB × hours allocated
- **Creations**: Number of `Sandbox.create()` calls
- **Network**: Data transferred in/out (GB)
- **Snapshot Storage**: GB-month for snapshots

## Example Costs

| Scenario | Duration | vCPUs | Cost |
|---|---|---|---|
| Quick test | 2 min | 1 | ~$0.01 |
| AI code validation | 5 min | 2 | ~$0.03 |
| Build and test | 30 min | 4 | ~$0.34 |
| Long-running task | 2 hr | 8 | ~$2.73 |

## Limits

### Resources

| Plan | Max vCPUs | Max Memory |
|---|---:|---:|
| Hobby | 4 | 8 GB |
| Pro | 8 | 16 GB |
| Enterprise | 32 | 64 GB |

### Runtime

- Hobby: 45 minutes max
- Pro/Enterprise: 5 hours max
- Default: 5 minutes

### Concurrency

- Hobby: 10 concurrent
- Pro/Enterprise: 2,000 concurrent

### Rate Limits (vCPU allocation)

- Hobby: 40/10 min
- Pro: 200/min
- Enterprise: 400/min

## Region

Currently only available in `iad1` (US East).

## Managing Costs

- Set appropriate timeouts
- Right-size vCPUs (start low, scale up if needed)
- Stop sandboxes promptly (call `sandbox.stop()`)
- Monitor in Usage dashboard