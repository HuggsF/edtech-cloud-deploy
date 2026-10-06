output "alb_endpoint" {
  description = "Public ALB URL for accessing the API"
  value       = "http://${module.alb.alb_dns_name}"
}

output "rds_address" {
  description = "RDS Endpoint Address"
  value       = module.rds.db_address
}

output "ecs_cluster_name" {
  description = "ECS Cluster Name"
  value       = module.ecs.cluster_name
}
