variable "environment" {
  description = "Environment name (dev, prod)"
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs for the RDS subnet group (minimum 2 AZs)"
  type        = list(string)
}

variable "security_group_ids" {
  description = "Security groups allowed to access the database"
  type        = list(string)
}

variable "instance_class" {
  description = "RDS instance class"
  type        = string
  default     = "db.t4g.micro"
}

variable "allocated_storage" {
  description = "Allocated storage in GB"
  type        = number
  default     = 20
}

variable "database_name" {
  description = "Database name"
  type        = string
  default     = "edtech"
}

variable "admin_username" {
  description = "Master username"
  type        = string
  default     = "edtech_admin"
}

variable "admin_password" {
  description = "Master password"
  type        = string
  sensitive   = true
}

variable "multi_az" {
  description = "Enable Multi-AZ deployment"
  type        = bool
  default     = false
}
