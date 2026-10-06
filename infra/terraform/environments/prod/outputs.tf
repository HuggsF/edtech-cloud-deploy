output "alb_endpoint" {
  description = "Public ALB URL for accessing the production API"
  value       = "http://${module.alb.alb_dns_name}"
}

output "rds_address" {
  description = "Production Multi-AZ RDS Endpoint Address"
  value       = module.rds.db_address
}

output "ecs_cluster_name" {
  description = "Production ECS Cluster Name"
  value       = module.ecs.cluster_name
}
