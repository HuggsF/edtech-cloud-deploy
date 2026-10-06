locals {
  # worker_resource_id = "service/<cluster_name>/<service_name>"
  resource_parts = split("/", var.worker_resource_id)
  cluster_name   = local.resource_parts[1]
  service_name   = local.resource_parts[2]
}

resource "aws_appautoscaling_target" "workers" {
  max_capacity       = var.max_capacity
  min_capacity       = var.min_capacity
  resource_id        = var.worker_resource_id
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

# ------------------------------------------------------------------------------
# Target tracking on BACKLOG PER WORKER TASK (queue depth / running tasks).
#
# Target tracking assumes the tracked metric falls as capacity is added (like CPU utilisation).
# Raw queue depth does not: with 10 tasks and 200 queued messages a target of 50 would ask for
# 10 x 200/50 = 40 tasks although each task only has 20 messages. Dividing by the running task
# count gives the metric the controller expects (AWS pattern for queue workers).
# ------------------------------------------------------------------------------
resource "aws_appautoscaling_policy" "queue_depth" {
  name               = "backlog-per-task-target-tracking-${var.environment}"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.workers.resource_id
  scalable_dimension = aws_appautoscaling_target.workers.scalable_dimension
  service_namespace  = aws_appautoscaling_target.workers.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = var.target_messages_per_worker
    scale_in_cooldown  = var.scale_in_cooldown
    scale_out_cooldown = var.scale_out_cooldown

    customized_metric_specification {
      # Published by the application (PutMetricData) with the QueueName dimension.
      metrics {
        id          = "depth"
        label       = "Messages waiting in ${var.queue_name}"
        return_data = false

        metric_stat {
          stat = "Average"
          metric {
            namespace   = var.metric_namespace
            metric_name = var.metric_name
            dimensions {
              name  = "QueueName"
              value = var.queue_name
            }
          }
        }
      }

      # Container Insights (enabled on the cluster).
      metrics {
        id          = "tasks"
        label       = "Running worker tasks"
        return_data = false

        metric_stat {
          stat = "Average"
          metric {
            namespace   = "ECS/ContainerInsights"
            metric_name = "RunningTaskCount"
            dimensions {
              name  = "ClusterName"
              value = local.cluster_name
            }
            dimensions {
              name  = "ServiceName"
              value = local.service_name
            }
          }
        }
      }

      metrics {
        id          = "backlog_per_task"
        label       = "Backlog per worker task"
        expression  = "depth / IF(tasks < 1, 1, tasks)"
        return_data = true
      }
    }
  }
}

# ------------------------------------------------------------------------------
# CloudWatch Alarm: queue depth beyond what the maximum fleet should hold
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
  alarm_description   = "Queue depth exceeds what the maximum number of workers is sized for"

  dimensions = {
    QueueName = var.queue_name
  }

  tags = {
    Environment = var.environment
  }
}
