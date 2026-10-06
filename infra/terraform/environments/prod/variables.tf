variable "environment" {
  type    = string
  default = "prod"
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "database_name" {
  type    = string
  default = "edtech"
}

variable "db_username" {
  type    = string
  default = "edtech_admin"
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "docker_image" {
  type        = string
  description = "ECR image URI for the container"
}

variable "rabbitmq_url" {
  type        = string
  description = "RabbitMQ connection string (Amazon MQ or self-hosted)"
  sensitive   = true
}
