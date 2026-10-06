variable "environment" {
  type = string
}

variable "aws_region" {
  type    = string
  default = "us-east-1"
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_ids" {
  type = list(string)
}

variable "target_group_arn" {
  type = string
}

variable "docker_image" {
  type = string
}

variable "db_host" {
  type = string
}

variable "db_port" {
  type = number
}

variable "db_name" {
  type = string
}

variable "db_user" {
  type = string
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "rabbitmq_url" {
  type = string
}

variable "api_desired_count" {
  type    = number
  default = 2
}

variable "api_cpu" {
  type    = string
  default = "256"
}

variable "api_memory" {
  type    = string
  default = "512"
}

variable "worker_min_capacity" {
  type    = number
  default = 2
}

variable "worker_cpu" {
  type    = string
  default = "256"
}

variable "worker_memory" {
  type    = string
  default = "512"
}

variable "worker_prefetch" {
  type    = number
  default = 10
}
