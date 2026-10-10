# TCP Congestion Control

The Transmission Control Protocol delivers a reliable stream of bytes over an unreliable network. Besides retransmitting lost packets, it must avoid overwhelming the network with more traffic than the links between sender and receiver can carry. Without this restraint, the early internet suffered congestion collapse, where useful throughput fell dramatically because links were saturated with retransmissions.

## Slow start and congestion avoidance

A TCP sender keeps a congestion window, the number of unacknowledged bytes allowed in flight. A new connection begins in slow start: the window starts small and roughly doubles every round trip as acknowledgements arrive. When the window reaches a threshold, the sender switches to congestion avoidance and grows the window by about one segment per round trip. This additive increase probes for available bandwidth gently.

## Reacting to loss

Packet loss is interpreted as a sign of congestion. When three duplicate acknowledgements arrive, classic algorithms halve the window and continue with fast recovery, a policy called multiplicative decrease. A timeout is treated as more severe, so the window is reset to a single segment and slow start begins again. The combination of additive increase and multiplicative decrease converges toward a fair share of the bottleneck among competing flows.

## Modern variants

Loss-based algorithms such as Reno and CUBIC fill router buffers until packets drop, which can cause high delay. Newer designs such as BBR estimate the bottleneck bandwidth and round-trip time directly and aim to keep queues short, improving latency on shared links.
