variable "environment" {
  type = string
}

variable "worker_resource_id" {
  description = "Resource ID of the ECS worker service (service/cluster_name/service_name)"
  type        = string
}

variable "min_capacity" {
  description = "Minimum number of worker replicas"
  type        = number
  default     = 2
}

variable "max_capacity" {
  description = "Maximum number of worker replicas"
  type        = number
  default     = 20
}

variable "target_messages_per_worker" {
  description = "Target backlog (queued messages) per running worker task"
  type        = number
  default     = 50
}

variable "metric_name" {
  description = "CloudWatch custom metric name"
  type        = string
  default     = "QueueDepth"
}

variable "metric_namespace" {
  description = "CloudWatch metric namespace"
  type        = string
  default     = "Custom/EdTech"
}

variable "scale_out_cooldown" {
  description = "Cooldown period in seconds before scaling out again"
  type        = number
  default     = 30
}

variable "scale_in_cooldown" {
  description = "Cooldown period in seconds before scaling in"
  type        = number
  default     = 300
}

variable "queue_name" {
  description = "RabbitMQ queue whose depth the workers publish as the QueueName dimension"
  type        = string
  default     = "edtech.tasks"
}
