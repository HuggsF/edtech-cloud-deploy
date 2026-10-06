resource "aws_appautoscaling_target" "workers" {
  max_capacity       = var.max_capacity
  min_capacity       = var.min_capacity
  resource_id        = var.worker_resource_id
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "queue_depth" {
  name               = "queue-depth-target-tracking-${var.environment}"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.workers.resource_id
  scalable_dimension = aws_appautoscaling_target.workers.scalable_dimension
  service_namespace  = aws_appautoscaling_target.workers.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = var.target_messages_per_worker
    scale_in_cooldown  = var.scale_in_cooldown
    scale_out_cooldown = var.scale_out_cooldown

    customized_metric_specification {
      metric_name = var.metric_name
      namespace   = var.metric_namespace
      statistic   = "Average"
    }
  }
}

# ------------------------------------------------------------------------------
# CloudWatch Alarm: High Queue Depth (Alerting)
# ------------------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "high_queue_depth" {
  alarm_name          = "edtech-high-queue-depth-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = var.metric_name
  namespace           = var.metric_namespace
  period              = 60
  statistic           = "Average"
  threshold           = var.target_messages_per_worker * var.max_capacity
  alarm_description   = "Alarm when task queue depth exceeds maximum worker capacity"

  tags = {
    Environment = var.environment
  }
}
