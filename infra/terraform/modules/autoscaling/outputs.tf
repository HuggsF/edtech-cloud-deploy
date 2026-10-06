output "autoscaling_target_arn" {
  description = "ARN of the scalable target"
  value       = aws_appautoscaling_target.workers.arn
}

output "autoscaling_policy_arn" {
  description = "ARN of the target tracking policy"
  value       = aws_appautoscaling_policy.queue_depth.arn
}

output "high_queue_alarm_arn" {
  description = "ARN of the CloudWatch high queue depth alarm"
  value       = aws_cloudwatch_metric_alarm.high_queue_depth.arn
}
